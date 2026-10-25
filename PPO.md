# TrackAI : Proximal Policy Optimization

L’IA apprend à conduire avec **Proximal Policy Optimization (PPO)**, un algorithme d’apprentissage par renforcement à actions continues. Le jeu envoie des observations à un serveur Python via un WebSocket. Le serveur transforme chaque observation en un vecteur d’état et renvoie les commandes de conduite au jeu. Pendant l’entraînement, l’observation suivante fournit la récompense et le signal de fin d’épisode associés à l’action précédente.

Ce document décrit l’implémentation répartie dans ces trois fichiers :

| Fichier | Responsabilité |
| --- | --- |
| [ai/main.py](ai/main.py) | Serveur WebSocket, commandes, épisodes, collecte partagée des expériences, hyperparamètres et métriques |
| [ai/ppo.py](ai/ppo.py) | Réseaux Actor-Critic, sélection des actions, GAE et optimisation PPO |
| [ai/utils.py](ai/utils.py) | Extraction de l’état, calcul de la récompense, buffers de rollout et checkpoints |

## Espace des actions

La politique produit **deux valeurs continues** :

$$
a_t = [\mathrm{drive}_t,\ \mathrm{steer}_t] \in [-1,1]^2
$$

| Composante | Interprétation |
| --- | --- |
| `drive > 0` | Accélérer avec `throttle = drive` |
| `drive < 0` | Freiner avec `brake = -drive` |
| `drive = 0` | Ni accélérer ni freiner |
| `steer` | Commande de direction signée, transmise directement au jeu |

`action_to_control()` écrête les deux composantes dans `[-1, 1]`. L’accélération et le freinage sont mutuellement exclusifs. À la fin d’un épisode d’entraînement, le serveur envoie des commandes d’accélération, de freinage et de direction nulles, avec `reset = True`.

## Espace des états

`extract_state()` construit un vecteur de **14 valeurs**, dans l’ordre suivant. Les indices commencent à zéro.

| Indices | Variables | Transformation |
| --- | --- | --- |
| `0` | Vitesse longitudinale signée | `forwardSpeed / 40.0`, avec une vitesse en m/s |
| `1` | Vitesse latérale signée | Vitesse dans le repère global projetée sur l’axe local droit du véhicule, puis divisée par `40.0` |
| `2..6` | Cinq capteurs de distance, dans l’ordre fourni par le jeu | `min(distance, 50.0) / 50.0` |
| `7` | Indicateur de sortie de piste | `1.0` hors piste, sinon `0.0` |
| `8..9` | Direction vers le point du circuit situé 10 m devant | Composantes locales droite et avant, déjà normalisées par le jeu |
| `10..11` | Direction vers le point du circuit situé 25 m devant | Composantes locales droite et avant, déjà normalisées par le jeu |
| `12..13` | Courbure signée du circuit à 15 m et 35 m devant | Déjà normalisée par division par $\pi$ côté jeu dans `utils.py` |

Le calcul de la vitesse latérale utilise le quaternion de rotation du véhicule pour exprimer la vitesse dans le repère de la voiture. Les directions de lookahead et les courbures renseignent l’agent sur les virages à venir.

La normalisation des vitesses **n’écrête pas** le résultat : ces variables peuvent dépasser `[-1, 1]`. Les capteurs de distance absents prennent la valeur de 50 m. Si le champ de lookahead est entièrement absent, sa valeur par défaut est `[0, 1, 0, 1]` ; celle de la courbure est `[0, 0]`.

`trackProgress` et `episodeEnd` servent aux récompenses, aux statistiques ou à la fin d’épisode, mais **ne sont pas** des entrées des réseaux de neurones.

## Récompense et épisodes

### Progression sur le circuit

À chaque transition, `compute_reward()` calcule la différence entre les progressions actuelle et précédente sur le circuit. La fonction corrige le bouclage au passage de la ligne de départ et d’arrivée :

```python
delta = progress - prev_progress
if delta < -0.5:
    delta += 1.0
elif delta > 0.5:
    delta -= 1.0
```

Une unité de progression représente un tour. Le franchissement de la ligne en marche avant conserve ainsi une progression positive, tandis qu’un franchissement en marche arrière reste négatif. Cette correction suppose que les variations de progression peuvent être interprétées à l’aide de ce seuil d’un demi-tour.

### Récompense d’une transition

On note $\Delta p_t$ la variation de progression corrigée, $v_{t+1}$ la vitesse longitudinale signée en m/s, $o_{t+1}$ l’indicateur de sortie de piste et $d_t$ l’indicateur de fin d’épisode. La récompense stockée est :

$$
r_t = 100\Delta p_t + 0.001\max(0,v_{t+1})
      - 0.5\,\mathbf{1}[v_{t+1}<1]
      - 0.5\,\mathbf{1}[v_{t+1}<0]
      - 1.0\,\mathbf{1}[o_{t+1}]
      - 2.0\,\mathbf{1}[d_t]
      - 0.02
$$


| Terme | Objectif |
| --- | --- |
| `100 * delta` | Récompenser la progression nette vers l’avant sur le circuit |
| `0.001 * max(0, forwardSpeed)` | Ajouter une faible incitation à avancer rapidement |
| `-0.02` par transition | Appliquer un coût temporel constant à chaque pas d’observation |
| `-0.5` lorsque la vitesse signée est inférieure à 1 m/s | Pénaliser l’immobilité et la marche arrière |
| `-0.5` supplémentaire lorsque la vitesse signée est négative | Pénaliser explicitement la marche arrière |
| `-1.0` hors piste | Pénaliser les sorties de piste |
| `-2.0` supplémentaire en fin d’épisode | Pénaliser la fin d’un épisode |

Ces pénalités se cumulent. Une transition terminale hors piste reçoit à la fois la pénalité de sortie de piste et celle de fin d’épisode. 

### Fin d’épisode

En mode entraînement, un épisode se termine dès qu’une de ces conditions est remplie :

- L’observation indique `offTrack = True`.
- L’observation indique `episodeEnd = True`.
- La valeur absolue de la vitesse longitudinale reste inférieure à **1 m/s pendant 120 transitions consécutives**.

Ce seuil de 120 pas représente environ quatre secondes à la fréquence d’observation de 30 Hz supposée par le commentaire de `main.py` ; le serveur compte les pas plutôt que de mesurer cette durée. Contrairement à la pénalité d’immobilité de la récompense, cette détection de blocage utilise la **valeur absolue** de la vitesse.

Le seul franchissement de la ligne ne termine pas un épisode dans le code Python. La progression se cumule sur plusieurs tours au sein d’un même épisode. Le score d’un épisode est la progression nette cumulée maximale atteinte, en partant de zéro, et non la somme des récompenses.

## Architecture des réseaux de neurones

L’Actor et le Critic sont **deux réseaux séparés, sans couches partagées**. Chacun possède deux couches cachées entièrement connectées de 64 neurones, avec une fonction d'activation Tanh.

```text
Actor:  Input (14) -> Linear(64) -> Tanh -> Linear(64) -> Tanh -> Linear(2) -> Tanh
Critic: Input (14) -> Linear(64) -> Tanh -> Linear(64) -> Tanh -> Linear(1)
```

### Actor

L’Actor répond à la question : **« Que dois-je faire ? »** Il prend l’état courant de la voiture et définit une distribution de probabilités sur les actions possibles. Ici, les actions sont continues : il choisit avec quelle intensité accélérer ou freiner et dans quelle direction tourner.

Pendant l’entraînement, une action est **échantillonnée** dans cette distribution. Cette part d’aléatoire permet à l’agent d’explorer différentes commandes dans des situations similaires et de découvrir de meilleures stratégies. À l’inférence, on utilise directement la **moyenne** de la distribution pour obtenir une conduite déterministe.

L’Actor produit un vecteur moyen $\mu_\theta(s) \in [-1,1]^2$. Un paramètre appris séparément, `log_std`, contient un logarithme d’écart-type par dimension d’action. Ces paramètres sont partagés entre les états ; l’accélération/freinage et la direction peuvent avoir des écarts-types différents.

La distribution utilisée par le code est un produit de lois normales indépendantes :

$$
p_\theta(a\mid s) = \prod_{j=1}^{2}
\mathcal{N}\bigl(a_j;\mu_{\theta,j}(s),\sigma_j^2\bigr)
$$

$$
\sigma_j = \exp\bigl(\max(\mathrm{log\_std}_j,\log(0.25))\bigr)
$$

Les écarts-types sont initialisés à **0.6**, avec un minimum de **0.25**. Ce plancher est appliqué lors de la construction de la distribution ainsi qu’aux paramètres après chaque pas de l’optimiseur.

Pendant l’entraînement, `act_train()` utilise `policy_old` pour échantillonner une action et stocker sa log-probabilité ainsi que l’estimation de valeur :

```python
dist = self._dist(state)
action = torch.clamp(dist.sample(), -1.0, 1.0)
action_logprob = dist.log_prob(action).sum(dim=-1)
```

À l’inférence, `act_play()` renvoie directement la moyenne, sans échantillonnage. Il n’y a ni sélection d’action discrète ni argmax.

### Critic 

Le Critic répond à la question : **« Cette situation est-elle favorable ? »** Il prend lui aussi l’état courant, mais renvoie un seul nombre : la valeur estimée de cet état. Cette valeur représente la somme des récompenses futures que l’agent peut espérer obtenir en moyenne à partir de cet état, en accordant moins de poids aux récompenses lointaines.

Il répond donc à la question : *« Si je me trouve dans cette situation et que je continue à suivre ma politique, quelle récompense cumulée puis-je espérer ? »* Il évalue les perspectives de l’agent à partir de cet état, au-delà de la récompense immédiate.

Le Critic produit un scalaire non borné $V_\phi(s)$ qui estime la récompense future actualisée sous la politique. Il fournit la baseline permettant d’estimer si une action a donné un résultat meilleur ou moins bon que prévu.

L’Actor et `log_std` utilisent un learning rate de **0.0003**, contre **0.001** pour le Critic. Les trois groupes de paramètres appartiennent au même optimiseur Adam. Ces valeurs relèvent de la configuration, et non d’une exigence de PPO.

### Pourquoi deux réseaux ?

Le Critic sert à **guider l’apprentissage de l’Actor**. Les récompenses indiquent ce qui s’est produit, mais elles ne suffisent pas à dire si le résultat d’une action est meilleur ou moins bon que ce qu’on pouvait attendre dans cette situation. Une même récompense peut être encourageante dans une situation difficile et décevante dans une situation favorable.

L’estimation du Critic fournit ce point de comparaison, appelé **baseline**. En la comparant aux récompenses et aux valeurs observées ensuite, on estime l’**avantage** de l’action : si le résultat est meilleur que prévu, l’Actor est incité à rendre cette action plus probable ; s’il est moins bon, à la rendre moins probable. Cette comparaison réduit la variance du signal d’apprentissage par rapport à l’utilisation des seuls returns. Dans ce projet, les avantages sont estimés avec GAE, détaillé plus bas.

## Estimation des avantages avec GAE

L’implémentation utilise **Generalized Advantage Estimation (GAE)** avec $\gamma=0.99$ et $\lambda=0.95$.

On note $v_t$ la valeur stockée pendant la collecte et $d_t$ l’indicateur terminal. La valeur suivante est l’estimation stockée au pas suivant, sauf pour une transition terminale ou la dernière transition du buffer d’entraînement, où elle vaut zéro :

$$
v_{t+1}^{\mathrm{next}} =
\begin{cases}
0 & \text{si } d_t=1 \text{ ou } t=N-1 \\
v_{t+1} & \text{sinon}
\end{cases}
$$

Le résidu de différence temporelle et l’avantage sont calculés en remontant le buffer :

$$
\delta_t = r_t + \gamma v_{t+1}^{\mathrm{next}} - v_t
$$

$$
\hat{A}_t = \delta_t + \gamma\lambda(1-d_t)\hat{A}_{t+1},
\qquad \hat{A}_N=0
$$

Un avantage positif favorise l’augmentation de la probabilité de l’action échantillonnée ; un avantage négatif favorise sa diminution.

Les indicateurs terminaux arrêtent la récurrence aux frontières normales des épisodes. À la dernière transition du buffer, la valeur suivante est nulle même si la transition n’est pas terminale : le code n’évalue pas d’observation finale pour effectuer un bootstrap sur un rollout tronqué. Un fragment non terminal issu d’une déconnexion ne possède pas de marqueur de frontière distinct ; GAE peut donc se propager dans le fragment ajouté à sa suite, s’il y en a un.

La cible du Critic est calculée **avant la normalisation des avantages** :

$$
\hat{R}_t = \hat{A}_t + v_t
$$

Pour les buffers de plus d’un échantillon, seuls les avantages sont centrés et réduits :

$$
\tilde{A}_t = \frac{\hat{A}_t - \operatorname{mean}(\hat{A})}
{\operatorname{std}(\hat{A}) + 10^{-8}}
$$

Les returns restent non normalisés. Les avantages et les cibles sont calculés une seule fois par mise à jour, puis réutilisés pendant toutes ses epochs d’optimisation.

## Proximal Policy Optimization

Chaque mise à jour réutilise les données pendant **10 epochs**. Les indices des échantillons sont mélangés aléatoirement à chaque epoch, puis répartis en mini-batches d’au plus **256 transitions**.

### Ancienne politique et politique entraînée

PPO conserve **deux copies du même modèle Actor-Critic**. L’ancienne politique est une copie de référence utilisée pour collecter les expériences ; ses poids restent fixes pendant une mise à jour d’entraînement. La politique entraînée est celle dont l’optimiseur modifie les poids pour améliorer les décisions de l’agent.

Cette séparation permet de mesurer **à quel point la politique a changé** : pour une action enregistrée, on compare sa probabilité sous la politique courante à celle qu’elle avait lors de la collecte. Les anciennes log-probabilités stockées conservent cette référence. PPO utilise leur ratio avec les nouvelles probabilités dans son objectif avec clipping, afin de limiter l’incitation à modifier trop fortement la politique en une seule mise à jour.

```python
self.policy      # mise à jour par Adam
self.policy_old  # utilisée pour sélectionner les actions et estimer les valeurs pendant la collecte
```

`policy_old` reste inchangée pendant une phase d’optimisation. Après toutes les epochs, elle reçoit les nouveaux poids :

```python
self.policy_old.load_state_dict(self.policy.state_dict())
```

Les anciennes log-probabilités stockées servent de référence pour calculer les ratios de probabilités de PPO.

### Ratio de probabilités

Les actions stockées sont réévaluées sous la politique courante :

$$
\rho_t(\theta) = \exp\left(
\log p_\theta(a_t\mid s_t)
- \log p_{\mathrm{old},t}(a_t\mid s_t)
\right)
$$

Les contributions des deux dimensions d’action s’additionnent dans chaque log-probabilité. Un ratio supérieur à un signifie que la densité gaussienne courante en cette action est supérieure à celle enregistrée pendant la collecte.

### Fonction de perte

Pour un mini-batch $B$, la loss minimisée est :

$$
\mathcal{L} =
-\frac{1}{|B|}\sum_{t\in B}
\min\left(
\rho_t\tilde{A}_t,
\operatorname{clip}(\rho_t,1-\varepsilon,1+\varepsilon)\tilde{A}_t
\right)
+ c_1\operatorname{MSE}\bigl(V_\phi(s_t),\hat{R}_t\bigr)
- c_2\frac{1}{|B|}\sum_{t\in B}H_t
$$

Les coefficients sont **$\varepsilon=0.2$, $c_1=0.5$ et $c_2=0.01$**.

1. **Objectif de politique avec clipping.** Le premier terme dans min() correspond à l'objectif non plafonné : le ratio multiplié par l'avantage. Le deuxième terme dans min() plafonne le rapport pour qu'il reste compris entre [1−ε,1+ε] (ici, ε=0,2, donc entre 0,8 et 1,2), puis le multiplie par l'avantage. Le fait de prendre la valeur minimale des deux garantit que la mise à jour n’est jamais trop importante : si le rapport s’éloigne trop de 1 (ce qui signifie que la politique a trop changé), le min limite le gradient. C’est le principe fondamental du PPO.
2. **Loss du Critic.** Le Critic est entrainé en minimisant la MSE entre ses valeurs prédites et les avantages réellement obtenus (cibles GAE fixes). 
3. **Bonus d’entropie.** Soustraire l’entropie encourage l’exploration. Le code additionne les entropies différentielles des deux lois normales :

$$
H_t = \sum_{j=1}^{2}\left[\log\sigma_j + \frac{1}{2}\log(2\pi e)\right]
$$

Pour chaque mini-batch, l’implémentation remet les gradients à zéro, rétropropage la loss moyenne, écrête la norme globale du gradient sur les paramètres de `policy` à **0.5**, applique Adam et impose le plancher d’écart-type. Après toutes les epochs, elle publie la nouvelle politique et vide le buffer d’entraînement. Il n’y a ni arrêt anticipé fondé sur la divergence KL ni planning de variation du learning rate.

## Hyperparamètres actuels

| Paramètre | Valeur | Définition |
| --- | --- | --- |
| Dimension de l’état | 14 | `utils.py` |
| Dimension de l’action | 2 | `utils.py` |
| Couches cachées par réseau | `[64, 64]`, Tanh | `main.py` |
| Learning rate de l’Actor et de `log_std` | `0.0003` | `main.py` |
| Learning rate du Critic | `0.001` | `main.py` |
| Facteur d’actualisation $\gamma$ | `0.99` | `main.py` |
| Paramètre GAE $\lambda$ | `0.95` | `main.py` |
| Clipping PPO $\varepsilon$ | `0.2` | `main.py` |
| Coefficient du Critic $c_1$ | `0.5` | `main.py` |
| Coefficient d’entropie $c_2$ | `0.01` | `main.py` |
| Epochs d’optimisation | `10` | `main.py` |
| Taille des mini-batches | `256` | `main.py` |
| Seuil global de collecte | `2048`, vérifié en fin d’épisode | `main.py` |
| Écart-type initial des actions | `0.6` par dimension | `main.py` |
| Écart-type minimal des actions | `0.25` par dimension | `ppo.py` |
| Norme maximale du gradient | `0.5` | `ppo.py` |
| Fréquence des checkpoints automatiques | Toutes les `100` mises à jour PPO | `main.py` |

PyTorch utilise CUDA s’il est disponible, sinon le CPU. La sélection du périphérique dans `utils.py` n’utilise pas le backend MPS d’Apple.

## Entraînement, inférence et persistance

Le serveur écoute par défaut sur `ws://127.0.0.1:8765` ; `TRACKAI_PORT` permet de remplacer le port.

- **Cold start :** `training_init` avec `mode = "cold"` réinitialise les deux copies de la politique et Adam.
- **Warm start :** `training_init` avec `mode = "warm"` charge le checkpoint sélectionné, y compris l’état de l’optimiseur lorsqu’il est présent. Un checkpoint sélectionné absent ou aux dimensions incompatibles provoque un retour au cold start. Les deux modes d’initialisation remettent à zéro les compteurs de session, les historiques et le buffer global.
- **Inférence :** `play_init` charge le checkpoint sélectionné. Si ce chargement échoue, il tente de charger le checkpoint sauvegardé au score le plus élevé. Les actions sont les moyennes déterministes ; l’inférence ne collecte pas de transitions d’entraînement et n’applique pas la logique de reset des épisodes d’entraînement.
- **Arrêt :** `stop_training` sauvegarde les poids courants et l’historique, puis arrête le traitement des observations d’entraînement. Aucune optimisation finale n’est lancée sur les expériences encore en attente.

Les checkpoints sont écrits dans `ai/results/weights/score_<score>_<timestamp>.pth`. Ils contiennent l’état de la politique, dont `log_std`, et celui de l’optimiseur. Le score du nom de fichier vaut `int(session_best_progress * 1000)` : un tour de progression cumulée maximale correspond à 1 000 points. Ce score n’est ni un cumul de récompenses ni un temps au tour ; il enregistre la meilleure progression de la session, sans évaluation distincte des poids sauvegardés.

Les poids sont sauvegardés toutes les 100 mises à jour PPO, lors d’un arrêt explicite de l’entraînement et lors d’un `KeyboardInterrupt` si un historique d’entraînement existe. Les historiques sont sauvegardés au format JSON dans `ai/results/series/` lors d’un arrêt explicite ou dans ce cas d’interruption. Le chargement prend aussi en charge les anciens checkpoints contenant uniquement un dictionnaire d’état de la politique.

Sur le même port, les endpoints HTTP exposent les checkpoints via `/weights` et les métriques en direct via `/metrics`. Les métriques distinguent les épisodes terminés (`iterations`) des mises à jour PPO (`trainings`). Le compteur courant `timestep` compte les transitions transférées dans le buffer global depuis son dernier remplacement, sans inclure les épisodes locaux en cours. L’historique des récompenses indique la récompense moyenne et maximale **par transition** dans chaque buffer d’entraînement ; celui des scores indique les statistiques de progression des épisodes. La réponse des métriques ne contient que les 300 derniers points de chaque historique.

## Collecte des expériences

Chaque connexion WebSocket représente une voiture IA et possède un `RolloutBuffer` local. Toutes les voitures en entraînement partagent le même `Agent` et le même buffer global. Chaque transition complète contient :

```text
état, action, ancienne log-probabilité, ancienne valeur d’état, récompense, indicateur terminal
```

L’action et la valeur sont stockées lors de la sélection de l’action ; la récompense et l’indicateur terminal arrivent avec l’observation suivante.

En fin d’épisode, `end_episode()` transfère les expériences locales dans le buffer global. Une mise à jour est déclenchée lorsque le compteur global atteint **au moins 2 048 transitions**. Cette vérification s’effectue en fin d’épisode : une mise à jour peut donc contenir davantage d’échantillons. Elle ne se déclenche pas après un nombre fixe d’épisodes ; les épisodes en cours restent dans leurs buffers locaux.

Lors d’une déconnexion, une éventuelle action en attente de récompense est supprimée et les expériences restantes sont transférées via `end_episode()`. La déconnexion ne marque pas explicitement la dernière transition complète comme terminale.

### Entraînement asynchrone

Avant l’optimisation, le buffer global est remplacé par un buffer vide sous verrou. L’entraînement sur le buffer détaché s’exécute dans un thread via `asyncio.to_thread()`. Un `asyncio.Lock` sérialise les mises à jour de l’optimiseur ; un `threading.Lock` protège la lecture et la publication des poids de `policy_old`.

Les autres connexions peuvent continuer à collecter des expériences pendant l’entraînement. Un épisode local peut donc couvrir plusieurs versions publiées de la politique ; la collecte n’est pas synchronisée entre toutes les voitures pour produire des rollouts issus d’une seule version de la politique. Une tâche d’envoi dédiée dispose aussi d’un emplacement unique pour l’action en attente : si l’envoi prend du retard, une action plus récente remplace celle qui attendait.