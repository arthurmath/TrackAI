# Jeu de voiture web 3D

## Contexte et objectif

Développe un jeu de voiture 3D dans le navigateur, **single-player, entièrement local**, inspiré de Trackmania : circuits en boucle chronométrés, physique réaliste, sensation de vitesse. L'environnement et le circuit doivent être visuellement cohérents et beaux. Le jeu doit tourner entièrement en frontend, fais un unique fichier HTML. 

---

## Stack technique 

| Couche   | Choix          |
| -------- | -------------- |
| Lanagage | **Typescript** |
| Rendu 3D | **Three.js**   |

---

## Physique véhicule 

Implémenter une dynamique des véhicules réaliste et satisfaisante :

- **Steering** : angle max ≈ 35°, retour au centre progressif (`lerpAngle`), réduction de l'angle de braquage à haute vitesse.
- **Moteur** : courbe d'accélération smooth réaliste, vitesse maximale, approximation simple de la vitesse de rotation/du couple.
- **Frein/dérapage** : friction latérale réaliste, prise en compte d'un virage trop serré entrainant un dérapage contrôlé.

---

## Rendu 3D et qualité visuelle

### Graphismes et ressources
- Design une voiture stylée dans le style Trackmania.
- Construire un circuit complet comprenant : une ligne de départ, un circuit avec de nombreux virages (une dizaine) et une ligne d'arrivée.
- Objectif de qualité graphique : matériaux PBR, ombres en temps réel, éclairage correct.


### Post-processing (via `three/examples/jsm/postprocessing`)
- **Bloom** léger (seuil haut) pour les feux et reflets
- **Motion Blur** (velocity-based) pour la sensation de vitesse

---

## Contrôles

| Action                 | Clavier   |
| ---------------------- | --------- |
| Accélérer              | `Z` / `↑` |
| Freiner/Marche arrière | `S` / `↓` |
| Tourner gauche         | `Q` / `←` |
| Tourner droite         | `D` / `→` |
| Reset position         | `R`       |
| Pause                  | `Escape`  |

---

## Caméra

Caméra de poursuite fluide qui suit la voiture, avec une légère augmentation du champ de vision à grande vitesse pour donner une impression de vitesse.

---

## Gameplay — mécaniques Trackmania

### Timer 
- Timer visible dès le départ (format `mm:ss.mmm`)
- Circuit en boucle : Compteur de tours (ex : 3 laps)
- Affichage du delta au meilleur temps précédent (+/- XX.XXX)

### Reset instantané
- Touche `R` → replace la voiture au début immédiatement

---

## HUD (DOM overlay, pas Three.js)

Interface overlay en HTML/CSS positionné en absolute sur le canvas :

```
┌─────────────────────────────────┐
│  LAP 2/3          00:01:23.456  │
│  BEST  00:01:19.002  △+04.454  │
│                                 │
│                         185 km/h│
│                        [====  ] │  ← speedometer arc SVG
└─────────────────────────────────┘
```

- Temps actuel, vitesse (km/h), écart actuel par rapport au meilleur temps.
- Speedomètre en arc SVG animé

---

## Performances

- Viser 60 FPS sur du matériel de milieu de gamme.
- Le mobile n'est **pas** ciblé ; optimisation pour les navigateurs de bureau (dernières versions de Chrome).