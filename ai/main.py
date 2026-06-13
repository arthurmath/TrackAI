import os
import json
import asyncio
import logging

import websockets

from ppo import Agent
from utils import (
    RolloutBuffer, extract_state, compute_reward,
    STATE_DIM, ACTION_DIM,
    load_best, save_weights, save_history,
)

# Réduit le bruit des erreurs de handshake websocket.
logging.getLogger("websockets").setLevel(logging.ERROR)

# Mode : "train" (apprentissage PPO) ou "play" (inférence avec les meilleurs poids).
MODE = os.environ.get("TRACKAI_MODE", "train")
PORT = int(os.environ.get("TRACKAI_PORT", "8765"))

# Entraîne dès que le buffer global atteint ce nombre de pas.
UPDATE_TIMESTEP = 2048
# Sauvegarde automatique des poids toutes les N mises à jour.
SAVE_EVERY = 10
# Coupe un épisode si la voiture reste quasi immobile trop longtemps (anti-blocage).
STUCK_LIMIT = 150        # pas
STUCK_SPEED = 1.0        # m/s
TERMINAL_PENALTY = 10.0


agent = Agent(
    state_dim=STATE_DIM,
    action_dim=ACTION_DIM,
    layers=[64, 64],
    lr_actor=0.0003,
    lr_critic=0.001,
    gamma=0.99,
    epochs=10,
    eps=0.2,
    c1=0.5,
    c2=0.01,
    gae_lambda=0.95,
    batch_size=256,
    action_std_init=0.6,
)

# État global partagé entre toutes les connexions (plusieurs voitures IA possibles).
global_buffer = RolloutBuffer()
global_timestep_count = 0
train_count = 0
iteration_count = 0
session_best_progress = 0.0
history_lock = asyncio.Lock()

scores_history = []      # progression max par épisode
rewards_history = []     # récompense moyenne par entraînement
episode_progress = []    # progressions des épisodes depuis le dernier entraînement


def action_to_control(action, reset=False):
    """Convertit le vecteur d'action continu en ControlState attendu par le jeu.

    action = [longitudinal, steer], chacun ~[-1, 1].
      longitudinal > 0 -> accélère ; < 0 -> freine / marche arrière.
    """
    a_long = max(-1.0, min(1.0, float(action[0])))
    a_steer = max(-1.0, min(1.0, float(action[1])))
    return {
        "throttle": max(0.0, a_long),
        "brake": max(0.0, -a_long),
        "steer": a_steer,
        "handbrake": False,
        "reset": reset,
    }


async def send_action(websocket, control):
    await websocket.send(json.dumps({"type": "action", "data": control}))


async def perform_training():
    global train_count, global_timestep_count
    if len(global_buffer.states) == 0:
        return
    print(f"\nTraining PPO (buffer size: {len(global_buffer.states)})")
    mean_reward = sum(global_buffer.rewards) / len(global_buffer.rewards)
    best_reward = max(global_buffer.rewards)

    await agent.train(global_buffer)

    async with history_lock:
        train_count += 1
        avg_progress = sum(episode_progress) / len(episode_progress) if episode_progress else 0.0
        scores_history.append({
            "iteration": iteration_count,
            "avg_progress": avg_progress,
            "best_progress": session_best_progress,
        })
        rewards_history.append({
            "iteration": iteration_count,
            "avg_reward": mean_reward,
            "best_reward": best_reward,
        })
        episode_progress.clear()
        global_timestep_count = 0

    print(f"Training complete. Total trainings: {train_count}, "
          f"avg progress: {avg_progress:.3f}, best: {session_best_progress:.3f}")

    if train_count % SAVE_EVERY == 0:
        save_weights(agent.policy, agent.optimizer, int(session_best_progress * 1000))


async def end_episode(local_buffer, max_progress):
    """Clôt l'épisode courant : déplace l'expérience locale vers le buffer global,
    met à jour les statistiques, et déclenche un entraînement si nécessaire."""
    global global_timestep_count, iteration_count, session_best_progress

    should_train = False
    async with history_lock:
        iteration_count += 1
        episode_progress.append(max_progress)
        if max_progress > session_best_progress:
            session_best_progress = max_progress
        if len(local_buffer.states) > 0:
            global_buffer.extend(local_buffer)
            global_timestep_count += len(local_buffer.states)
        if global_timestep_count >= UPDATE_TIMESTEP:
            should_train = True
    local_buffer.clear()

    if should_train:
        await perform_training()


async def play_game(websocket):
    """Une connexion = une voiture IA. Non bloquant : répond à chaque observation."""
    local_buffer = RolloutBuffer()
    prev_progress = None
    max_progress = 0.0
    stuck_steps = 0

    try:
        async for message in websocket:
            msg = json.loads(message)
            if msg.get("type") != "observation":
                continue
            obs = msg.get("data", {})
            progress = float(obs.get("trackProgress", 0.0))
            forward_speed = abs(float(obs.get("forwardSpeed", 0.0)))
            off_track = bool(obs.get("offTrack", False))

            max_progress = max(max_progress, progress)

            # --- Mode inférence : action déterministe, pas d'apprentissage -----
            if MODE != "train":
                state = extract_state(obs)
                action, _ = agent.act_play(state)
                await send_action(websocket, action_to_control(action))
                continue

            # --- Mode entraînement ---------------------------------------------
            # 1) Récompense de la transition due à l'action précédente.
            if len(local_buffer.states) > len(local_buffer.rewards):
                reward, _ = compute_reward(prev_progress, obs)

                if forward_speed < STUCK_SPEED:
                    stuck_steps += 1
                else:
                    stuck_steps = 0
                done = off_track or stuck_steps >= STUCK_LIMIT

                if done:
                    reward -= TERMINAL_PENALTY
                local_buffer.rewards.append(reward)
                local_buffer.is_terminals.append(done)

                if done:
                    # Fin d'épisode : on demande un respawn et on remet à zéro.
                    await send_action(websocket, action_to_control([0.0, 0.0], reset=True))
                    await end_episode(local_buffer, max_progress)
                    prev_progress = None
                    max_progress = 0.0
                    stuck_steps = 0
                    continue

            # 2) Nouvelle action à partir de l'état courant.
            state = extract_state(obs)
            action = agent.act_train(state, local_buffer)
            prev_progress = progress
            await send_action(websocket, action_to_control(action))

    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        if MODE == "train":
            # Réaligne states/rewards si déconnexion avant d'avoir noté la récompense.
            if len(local_buffer.states) > len(local_buffer.rewards):
                local_buffer.states.pop()
                local_buffer.actions.pop()
                local_buffer.logprobs.pop()
                local_buffer.state_values.pop()
            if len(local_buffer.states) > 0:
                await end_episode(local_buffer, max_progress)


async def main():
    print(f"Starting TrackAI server on ws://127.0.0.1:{PORT}  (mode={MODE})")
    if MODE != "train":
        load_best(agent.policy, agent.policy_old)
    else:
        # Warm start si des poids existent déjà (reprise d'entraînement).
        load_best(agent.policy, agent.policy_old, agent.optimizer)

    stop = asyncio.Future()
    try:
        async with websockets.serve(play_game, "127.0.0.1", PORT):
            await stop
    except websockets.exceptions.ConnectionClosed:
        pass


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        if MODE == "train":
            print("\nServer stopping. Saving weights and history.")
            save_weights(agent.policy, agent.optimizer, int(session_best_progress * 1000))
            save_history(scores_history, rewards_history)
        print("Server stopped")
