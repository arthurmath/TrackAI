import os
import glob
import json
import torch
from datetime import datetime


device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

# Dossiers de sortie, relatifs à ce fichier (et non au cwd du lancement).
_BASE_DIR = os.path.dirname(os.path.abspath(__file__))
weights_dir = os.path.join(_BASE_DIR, "results", "weights")
series_dir = os.path.join(_BASE_DIR, "results", "series")
os.makedirs(weights_dir, exist_ok=True)
os.makedirs(series_dir, exist_ok=True)


# --- Dimensions du problème (partagées par main.py et l'agent) ----------------
# État : [forwardSpeed, lateralSpeed, 5 capteurs, offTrack] -> 8
STATE_DIM = 8
# Action continue : [longitudinal (throttle/brake), steer] -> 2
ACTION_DIM = 2
SENSOR_MAX = 50.0          # doit correspondre à SENSOR_MAX dans RaceSession.ts
SPEED_NORM = 40.0          # normalisation des vitesses (m/s)


class RolloutBuffer:
    def __init__(self):
        self.actions = []
        self.states = []
        self.logprobs = []
        self.rewards = []
        self.state_values = []
        self.is_terminals = []

    def clear(self):
        del self.actions[:]
        del self.states[:]
        del self.logprobs[:]
        del self.rewards[:]
        del self.state_values[:]
        del self.is_terminals[:]

    def extend(self, other):
        self.actions.extend(other.actions)
        self.states.extend(other.states)
        self.logprobs.extend(other.logprobs)
        self.rewards.extend(other.rewards)
        self.state_values.extend(other.state_values)
        self.is_terminals.extend(other.is_terminals)


def format(buffer):
    """Empile les tenseurs du buffer pour l'entraînement.

    states   -> [N, STATE_DIM]
    actions  -> [N, ACTION_DIM]
    logprobs -> [N]
    values   -> [N]
    """
    old_states = torch.stack(buffer.states, dim=0).detach().to(device)
    old_actions = torch.stack(buffer.actions, dim=0).detach().to(device)
    old_logprobs = torch.stack(buffer.logprobs, dim=0).detach().to(device)
    old_state_values = torch.stack(buffer.state_values, dim=0).detach().to(device)

    if old_states.dim() == 1:
        old_states = old_states.unsqueeze(0)
    if old_actions.dim() == 1:
        old_actions = old_actions.unsqueeze(0)
    old_logprobs = old_logprobs.reshape(-1)
    old_state_values = old_state_values.reshape(-1)

    return old_states, old_actions, old_logprobs, old_state_values


# --- Adaptation au jeu de voiture --------------------------------------------

def _right_vector(q):
    """Vecteur 'droite' (axe local +X) du véhicule à partir du quaternion."""
    x, y, z, w = q
    rx = 1.0 - 2.0 * (y * y + z * z)
    ry = 2.0 * (x * y + z * w)
    rz = 2.0 * (x * z - y * w)
    return rx, ry, rz


def extract_state(obs):
    """Convertit une VehicleObservation (cf. Controller.ts) en vecteur d'état.

    Champs utilisés : forwardSpeed, velocity, rotation, sensors, offTrack.
    """
    fs = float(obs.get("forwardSpeed", 0.0))
    vel = obs.get("velocity", [0.0, 0.0, 0.0])
    rot = obs.get("rotation", [0.0, 0.0, 0.0, 1.0])
    sensors = obs.get("sensors", [])
    off = bool(obs.get("offTrack", False))

    # Vitesse latérale signée = projection de la vitesse sur l'axe droite.
    rx, ry, rz = _right_vector(rot)
    lateral = vel[0] * rx + vel[1] * ry + vel[2] * rz

    state = [fs / SPEED_NORM, lateral / SPEED_NORM]
    for i in range(5):
        d = sensors[i] if i < len(sensors) else SENSOR_MAX
        state.append(min(float(d), SENSOR_MAX) / SENSOR_MAX)
    state.append(1.0 if off else 0.0)
    return state


def compute_reward(prev_progress, obs):
    """Récompense d'une transition. Retourne (reward, delta_progress).

    - Avancement sur le circuit (principal moteur d'apprentissage).
    - Petit bonus de vitesse pour éviter de rester immobile.
    - Pénalité hors-piste.
    Gère le bouclage de la progression (fin de tour : 1.0 -> 0.0).
    """
    progress = float(obs.get("trackProgress", 0.0))
    delta = progress - prev_progress
    if delta < -0.5:      # bouclage de tour
        delta += 1.0
    elif delta > 0.5:     # téléportation/respawn vers l'arrière
        delta -= 1.0

    reward = delta * 100.0
    reward += float(obs.get("forwardSpeed", 0.0)) * 0.01
    if obs.get("offTrack", False):
        reward -= 1.0
    return reward, delta


# --- Sauvegarde / chargement des poids ---------------------------------------

def save_weights(policy, optimizer, score):
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = os.path.join(weights_dir, f"score_{int(score)}_{timestamp}.pth")
    torch.save({
        "policy": policy.state_dict(),
        "optimizer": optimizer.state_dict(),
    }, filename)
    print(f"Saved weights to {filename}")


def _load_checkpoint(path, policy, policy_old, optimizer=None):
    """Charge un checkpoint, gérant l'ancien format (state dict brut)
    et le nouveau (dict avec 'policy'/'optimizer')."""
    checkpoint = torch.load(path, map_location=device, weights_only=True)
    if isinstance(checkpoint, dict) and "policy" in checkpoint:
        policy_state = checkpoint["policy"]
        if optimizer is not None and "optimizer" in checkpoint:
            optimizer.load_state_dict(checkpoint["optimizer"])
            print("  Optimizer state restored.")
        else:
            print("  No optimizer state restored.")
    else:
        policy_state = checkpoint
        print("  Legacy weights format (no optimizer state).")
    policy.load_state_dict(policy_state)
    policy_old.load_state_dict(policy_state)


def load_best(policy, policy_old, optimizer=None):
    files = glob.glob(os.path.join(weights_dir, "score_*.pth"))
    if not files:
        print("No weights found to load.")
        return False

    best_file = None
    best_score = -1.0
    for f in files:
        try:
            score = float(os.path.basename(f).split("_")[1])
            if score > best_score:
                best_score = score
                best_file = f
        except Exception:
            pass

    if best_file:
        print(f"Loading best weights: {best_file}")
        _load_checkpoint(best_file, policy, policy_old, optimizer)
        return True
    return False


def save_history(scores_history, rewards_history):
    """Sauvegarde les séries d'entraînement (JSON) pour analyse ultérieure."""
    if not scores_history and not rewards_history:
        print("No data to save.")
        return
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    path = os.path.join(series_dir, f"history_{timestamp}.json")
    with open(path, "w", encoding="utf-8") as fp:
        json.dump({
            "scores_history": scores_history,
            "rewards_history": rewards_history,
        }, fp, indent=2)
    print(f"History saved to {path}")
