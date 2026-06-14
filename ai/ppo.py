import math
import asyncio
import torch
import torch.nn as nn
from torch.distributions import Normal

from utils import device, format


class ActorCritic(nn.Module):
    """Réseau acteur-critique pour actions CONTINUES.

    L'acteur produit une moyenne par dimension d'action (bornée par tanh dans
    [-1, 1]) ; l'écart-type est un paramètre appris global (log_std). Les actions
    sont échantillonnées dans une loi normale puis clampées côté jeu.
    """

    def __init__(self, state_dim, action_dim, layers, action_std_init=0.6):
        super().__init__()
        self.action_dim = action_dim

        actor_layers = []
        last_dim = state_dim
        for layer_dim in layers:
            actor_layers.append(nn.Linear(last_dim, layer_dim))
            actor_layers.append(nn.Tanh())
            last_dim = layer_dim
        actor_layers.append(nn.Linear(last_dim, action_dim))
        actor_layers.append(nn.Tanh())  # moyenne dans [-1, 1]
        self.actor = nn.Sequential(*actor_layers)

        critic_layers = []
        last_dim = state_dim
        for layer_dim in layers:
            critic_layers.append(nn.Linear(last_dim, layer_dim))
            critic_layers.append(nn.Tanh())
            last_dim = layer_dim
        critic_layers.append(nn.Linear(last_dim, 1))
        self.critic = nn.Sequential(*critic_layers)

        # Écart-type appris (log) — partagé entre tous les états.
        self.log_std = nn.Parameter(torch.ones(action_dim) * math.log(action_std_init))

    def _dist(self, state):
        mean = self.actor(state)
        std = self.log_std.exp().expand_as(mean)
        return Normal(mean, std)

    def act(self, state):
        dist = self._dist(state)
        action = dist.sample()
        action_logprob = dist.log_prob(action).sum(dim=-1)
        state_val = self.critic(state)
        return action.detach(), action_logprob.detach(), state_val.detach()

    def evaluate(self, state, action):
        dist = self._dist(state)
        action_logprobs = dist.log_prob(action).sum(dim=-1)
        dist_entropy = dist.entropy().sum(dim=-1)
        state_values = self.critic(state)
        return action_logprobs, state_values, dist_entropy


class Agent:
    def __init__(self, state_dim, action_dim, layers, lr_actor, lr_critic,
                 gamma, epochs, eps, c1, c2, gae_lambda, batch_size,
                 action_std_init=0.6):
        self.epochs = epochs
        self.gamma = gamma
        self.eps = eps
        self.c1 = c1
        self.c2 = c2
        self.gae_lambda = gae_lambda
        self.batch_size = batch_size
        self._state_dim = state_dim
        self._action_dim = action_dim
        self._layers = layers
        self._action_std_init = action_std_init
        self._lr_actor = lr_actor
        self._lr_critic = lr_critic

        self.policy = ActorCritic(state_dim, action_dim, layers, action_std_init).to(device)
        self.policy_old = ActorCritic(state_dim, action_dim, layers, action_std_init).to(device)
        self.policy_old.load_state_dict(self.policy.state_dict())

        self.loss = nn.MSELoss()
        self.optimizer = torch.optim.Adam([
            {"params": self.policy.actor.parameters(), "lr": lr_actor},
            {"params": self.policy.critic.parameters(), "lr": lr_critic},
            {"params": [self.policy.log_std], "lr": lr_actor},
        ])

        # Évite que des mises à jour simultanées (plusieurs agents) ne se chevauchent.
        self.update_lock = asyncio.Lock()

    def reinitialize(self):
        """Réinitialise aléatoirement les poids et l'optimiseur (cold start)."""
        self.policy = ActorCritic(
            self._state_dim, self._action_dim, self._layers, self._action_std_init,
        ).to(device)
        self.policy_old = ActorCritic(
            self._state_dim, self._action_dim, self._layers, self._action_std_init,
        ).to(device)
        self.policy_old.load_state_dict(self.policy.state_dict())
        self.optimizer = torch.optim.Adam([
            {"params": self.policy.actor.parameters(), "lr": self._lr_actor},
            {"params": self.policy.critic.parameters(), "lr": self._lr_critic},
            {"params": [self.policy.log_std], "lr": self._lr_actor},
        ])
        print("Cold start: neural network weights reinitialized.")

    def act_play(self, state): 
        """Action déterministe (moyenne) pour l'inférence/démo."""
        with torch.no_grad():
            state_t = torch.FloatTensor(state).to(device)
            mean = self.policy_old.actor(state_t)
            state_val = self.policy_old.critic(state_t)
        return mean.tolist(), state_val.item()

    def act_train(self, state, buffer):
        """Échantillonne une action et la stocke dans le buffer."""
        with torch.no_grad():
            state_t = torch.FloatTensor(state).to(device)
            action, action_logprob, state_val = self.policy_old.act(state_t)

        buffer.states.append(state_t)
        buffer.actions.append(action)
        buffer.logprobs.append(action_logprob)
        buffer.state_values.append(state_val)

        return action.tolist()

    async def train(self, buffer):
        async with self.update_lock:
            if len(buffer.states) == 0:
                return

            old_states, old_actions, old_logprobs, old_state_values = format(buffer)

            # GAE (Generalized Advantage Estimation)
            values_list = old_state_values.detach().cpu().tolist()
            advantages_list = [0.0] * len(buffer.rewards)
            gae = 0.0
            for i in reversed(range(len(buffer.rewards))):
                is_terminal = buffer.is_terminals[i]
                next_value = 0.0 if (is_terminal or i == len(buffer.rewards) - 1) else values_list[i + 1]
                delta = buffer.rewards[i] + self.gamma * next_value - values_list[i]
                gae = delta + self.gamma * self.gae_lambda * (0.0 if is_terminal else gae)
                advantages_list[i] = gae

            advantages = torch.tensor(advantages_list, dtype=torch.float32, device=device)
            returns = advantages + old_state_values.detach()

            if len(advantages) > 1:
                advantages = (advantages - advantages.mean()) / (advantages.std() + 1e-8)

            n_samples = len(old_states)
            batch_size = min(self.batch_size, n_samples)

            for _ in range(self.epochs):
                indices = torch.randperm(n_samples, device=device)
                for start in range(0, n_samples, batch_size):
                    idx = indices[start:start + batch_size]
                    mb_states = old_states[idx]
                    mb_actions = old_actions[idx]
                    mb_logprobs = old_logprobs[idx]
                    mb_advantages = advantages[idx]
                    mb_returns = returns[idx]

                    logprobs, state_values, dist_entropy = self.policy.evaluate(mb_states, mb_actions)
                    state_values = torch.squeeze(state_values)
                    if state_values.dim() == 0:
                        state_values = state_values.unsqueeze(0)

                    ratios = torch.exp(logprobs - mb_logprobs.detach())

                    surr1 = ratios * mb_advantages
                    surr2 = torch.clamp(ratios, 1 - self.eps, 1 + self.eps) * mb_advantages

                    loss = -torch.min(surr1, surr2) + self.c1 * self.loss(state_values, mb_returns) - self.c2 * dist_entropy

                    self.optimizer.zero_grad()
                    loss.mean().backward()
                    torch.nn.utils.clip_grad_norm_(self.policy.parameters(), 0.5)
                    self.optimizer.step()

            self.policy_old.load_state_dict(self.policy.state_dict())
            buffer.clear()
