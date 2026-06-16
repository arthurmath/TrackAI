import os
import json
import asyncio
import logging

import websockets

from ppo import Agent
from utils import (
    RolloutBuffer, extract_state, compute_reward,
    STATE_DIM, ACTION_DIM,
    load_best, load_checkpoint_file, list_saved_weights,
    save_weights, save_history,
)

# Réduit le bruit des erreurs de handshake websocket.
logging.getLogger("websockets").setLevel(logging.ERROR)

PORT = int(os.environ.get("TRACKAI_PORT", "8765"))

# Entraîne dès que le buffer global atteint ce nombre de pas.
UPDATE_TIMESTEP = 2048
# Sauvegarde automatique des poids toutes les N entrainements PPO.
SAVE_EVERY = 100
# Coupe un épisode si la voiture reste quasi immobile trop longtemps (anti-blocage).
# 30 Hz d'observations × 4 s = 120 pas (aligné sur AI_CONFIG.trainingStuckSeconds).
STUCK_LIMIT = 120        # pas
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

# État global partagé entre toutes les connexions d'entraînement.
global_buffer = RolloutBuffer()
global_timestep_count = 0
train_count = 0
iteration_count = 0
session_best_progress = 0.0
history_lock = asyncio.Lock()

scores_history = []      # progression max par épisode
rewards_history = []     # récompense moyenne par entraînement
episode_progress = []    # progressions des épisodes depuis le dernier entraînement
stop_requested = False
stop_save_lock = asyncio.Lock()
active_connections = 0
connection_lock = asyncio.Lock()
training_init_applied = False
training_init_lock = asyncio.Lock()


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


async def reset_training_counters():
    """Remet à zéro les compteurs d'une nouvelle session d'entraînement."""
    global train_count, global_timestep_count, iteration_count
    global session_best_progress, stop_requested
    global scores_history, rewards_history, episode_progress

    async with history_lock:
        train_count = 0
        global_timestep_count = 0
        iteration_count = 0
        session_best_progress = 0.0
        scores_history = []
        rewards_history = []
        episode_progress = []
        global_buffer.clear()
    async with stop_save_lock:
        stop_requested = False


async def apply_training_init(data):
    """Applique cold start ou warm start (une seule fois par session)."""
    global training_init_applied

    async with training_init_lock:
        if training_init_applied:
            return
        training_init_applied = True

    await reset_training_counters()

    mode = data.get("mode")
    if mode == "cold":
        agent.reinitialize()
        print("Training init: cold start.")
    elif mode == "warm":
        filename = data.get("weightsFile", "")
        if not load_checkpoint_file(filename, agent.policy, agent.policy_old, agent.optimizer):
            print(f"Warm start failed for {filename!r}, falling back to cold start.")
            agent.reinitialize()
        else:
            print(f"Training init: warm start from {filename}.")
    else:
        print(f"Unknown training init mode {mode!r}, using cold start.")
        agent.reinitialize()


async def apply_play_init(data):
    """Charge les poids choisis par le client (mode inférence / AI Player)."""
    filename = data.get("weightsFile", "")
    if not load_checkpoint_file(filename, agent.policy, agent.policy_old):
        print(f"Play init failed for {filename!r}, falling back to best weights.")
        load_best(agent.policy, agent.policy_old)
    else:
        print(f"Inference mode. Initialized with weights {filename}.")


async def handle_stop_training():
    """Arrête l'entraînement et enregistre poids + historique (une seule fois)."""
    global stop_requested
    async with stop_save_lock:
        if stop_requested:
            return
        stop_requested = True
        print("\nStop training requested. Saving weights and history.")
        save_weights(agent.policy, agent.optimizer, int(session_best_progress * 1000))
        save_history(scores_history, rewards_history)


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


async def start(websocket):
    """Une connexion = une voiture IA. Mode play ou train selon le message d'init."""
    global active_connections, stop_requested, training_init_applied

    conn_mode = None  # "play" | "train"

    async with connection_lock:
        active_connections += 1

    local_buffer = RolloutBuffer()
    prev_progress = None
    max_progress = 0.0
    stuck_steps = 0

    try:
        async for message in websocket:
            msg = json.loads(message)
            if msg.get("type") == "stop_training":
                if conn_mode == "train":
                    await handle_stop_training()
                continue
            if msg.get("type") == "training_init":
                await apply_training_init(msg.get("data", {}))
                conn_mode = "train"
                continue
            if msg.get("type") == "play_init":
                await apply_play_init(msg.get("data", {}))
                conn_mode = "play"
                continue
            if conn_mode is None:
                if training_init_applied:
                    conn_mode = "train"
                else:
                    continue
            if conn_mode == "train" and stop_requested:
                continue
            if conn_mode == "train" and not training_init_applied:
                continue
            if msg.get("type") != "observation":
                continue
            obs = msg.get("data", {})
            progress = float(obs.get("trackProgress", 0.0))
            forward_speed = abs(float(obs.get("forwardSpeed", 0.0)))
            off_track = bool(obs.get("offTrack", False))
            episode_end = bool(obs.get("episodeEnd", False))

            max_progress = max(max_progress, progress)

            # --- Mode inférence (AI Player) ------------------------------------
            if conn_mode == "play":
                state = extract_state(obs)
                action, _ = agent.act_play(state)
                await send_action(websocket, action_to_control(action))
                continue

            # --- Mode entraînement ---------------------------------------------
            if len(local_buffer.states) > len(local_buffer.rewards):
                reward, _ = compute_reward(prev_progress, obs)

                if forward_speed < STUCK_SPEED:
                    stuck_steps += 1
                else:
                    stuck_steps = 0
                done = off_track or episode_end or stuck_steps >= STUCK_LIMIT

                if done:
                    reward -= TERMINAL_PENALTY
                local_buffer.rewards.append(reward)
                local_buffer.is_terminals.append(done)

                if done:
                    await send_action(websocket, action_to_control([0.0, 0.0], reset=True))
                    await end_episode(local_buffer, max_progress)
                    prev_progress = None
                    max_progress = 0.0
                    stuck_steps = 0
                    continue

            state = extract_state(obs)
            action = agent.act_train(state, local_buffer)
            prev_progress = progress
            await send_action(websocket, action_to_control(action))

    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        async with connection_lock:
            active_connections -= 1
            if active_connections == 0:
                async with training_init_lock:
                    training_init_applied = False
        if conn_mode == "train":
            if len(local_buffer.states) > len(local_buffer.rewards):
                local_buffer.states.pop()
                local_buffer.actions.pop()
                local_buffer.logprobs.pop()
                local_buffer.state_values.pop()
            if len(local_buffer.states) > 0:
                await end_episode(local_buffer, max_progress)


async def process_request(connection, request):
    """Expose la liste des poids via HTTP GET /weights (même port que le WebSocket)."""
    if request.path != "/weights":
        return None
    response = connection.respond(200, json.dumps(list_saved_weights()))
    response.headers["Content-Type"] = "application/json"
    response.headers["Access-Control-Allow-Origin"] = "*"
    return response


async def main():
    print(f"\nStarting Websocket server on ws://127.0.0.1:{PORT}\n")

    stop = asyncio.Future()
    try:
        async with websockets.serve(
            start, "127.0.0.1", PORT, process_request=process_request,
        ):
            await stop
    except websockets.exceptions.ConnectionClosed:
        pass


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        if training_init_applied and (scores_history or rewards_history):
            print("\nServer stopping. Saving weights and history.")
            save_weights(agent.policy, agent.optimizer, int(session_best_progress * 1000))
            save_history(scores_history, rewards_history)
        print("Server stopped")
