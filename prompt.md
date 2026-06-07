# Jeu de voiture web 3D

## Contexte et objectif

Développe un jeu de voiture 3D dans le navigateur, **single-player, entièrement local**, inspiré de Trackmania : circuits chronométrés, physique réaliste, sensation de vitesse, support d'assets 3D réalistes importés depuis Blender ou Sketchfab. L'environnement et les circuits doivent être visuellement cohérents et beaux. Le jeu doit tourner entièrement en frontend (SPA HTML simple + JS). Les données seront stockées dans `localStorage`/`IndexedDB`. Il y aura deux modes de jeu : soit par un humain, soit par un réseau de neurones pytorch qui s'entrainera à conduire par Reinforcement Learning. La partie jeu sera dans le dossier game/, la partie python sera dans un dossier ai/. **N'écrit pas les fichiers de la partie python (ai/)**, mais fait un fichier controlleur avec HumanController et un AIControler communiquant via un serveur python Websocket.

---

## Stack technique 

| Couche             | Choix                                                                           |
| ------------------ | ------------------------------------------------------------------------------- |
| Bundler            | **Vite**                                                                        |
| Lanagage           | **Typescript** (strict mode)                                                    |
| Rendu 3D           | **Three.js** (r165+)                                                            |
| Physique           | **Rapier.js** (WASM) — moteur rigide, véhicule à contraintes, collision précise |
| Format assets 3D   | **glTF 2.0 / GLB** (export Blender → glTF, Sketchfab → glTF)                    |
| Chargeur d'assets  | `GLTFLoader` (Three.js) + `DRACOLoader` pour la compression des géométries      |
| Gestion des inputs | `KeyboardEvent`                                                                 |


---

## Architecture du projet

```
ai/
game/
  public/
    models/      (.glb cars, trees, tracks assets)
    textures/
  src/
    core/        (game loop, time step, input manager)
    physics/     (Rapier world setup, vehicle controller)
    rendering/   (Three.js scene, camera, post-processing)
    assets/      (cars, tracks)
    game/        (game states, race logic, timing, scoring)
    ui/          (HUD, menus, leaderboard)
    utils/       (asset loader, glTF management)
```


---

## Physique véhicule (priorité haute)

Implémenter une dynamique des véhicules réaliste et satisfaisante à l'aide d'un **modèle de véhicule par raycasting**.

Utiliser le **`VehicleController` de Rapier.js** (implémentation Raycast Vehicle, standard AAA) :

- **Steering** : angle max ≈ 35°, retour au centre progressif (`lerpAngle`), réduction de l'angle de braquage à haute vitesse.
- **Moteur** : courbe d'accélération smooth réaliste, vitesse maximale, approximation simple de la vitesse de rotation/du couple.
- **Frein/dérapage** : friction latérale réaliste, prise en compte d'un virage trop serré entrainant un dérapage contrôlé.
- **Centre de gravité** bas et configurable** pour éviter le retournement

Chaque voiture aura ses propres paramètres. Paramètres de base à exposer dans les fichiers `vehicleConfig.ts` ou json :
```ts
export const VEHICLE_CONFIG = {
  mass: 1200,            // kg
  suspensionRestLength: 0.3,
  suspensionStiffness: 30,
  suspensionDamping: 4.5,
  maxSteering: 0.6,      // radians
  engineForce: 3000,
  brakeForce: 150,
  handbrakeForce: 400,
  wheelFriction: 1.8,
  lateralFriction: 0.9,
  centerOfMassOffset: { x: 0, y: -0.2, z: 0 }
};
```

---

## Rendu 3D et qualité visuelle

### Graphismes et ressources
- Charger les ressources 3D (voitures et circuits) sous forme de **fichiers GLB** via le `GLTFLoader` de Three.js (avec `DRACOLoader`/`MeshoptDecoder`).
- Mettre en place un **processus de chargement des ressources** fluide, avec un écran de chargement et une barre de progression.
- Étant donné qu'on fournira plus tard de véritables ressources provenant de Blender/Sketchfab, **mettre en place une structure avec des primitives de remplacement** (une voiture cubique + un circuit simple) pouvant être remplacées par des GLB en modifiant uniquement la configuration/les chemins d'accès des ressources. Documenter les conventions attendues pour les modèles (échelle en mètres, axe Y vers le haut, placement de l'origine, convention de nommage des roues afin que celles-ci puissent être localisées et animées).
- Objectif de qualité graphique : matériaux PBR, ombres en temps réel, éclairage correct.


### Post-processing (via `three/examples/jsm/postprocessing`)
- **Bloom** léger (seuil haut) pour les feux et reflets
- **Motion Blur** (velocity-based) pour la sensation de vitesse
- **SSAO** (Screen Space Ambient Occlusion) pour la profondeur (en option)
Laisser la possibilité de l'activer/désactiver pour des raisons de performances.

### Éclairage
- `DirectionalLight` principal avec `CastShadow` (soleil)
- `AmbientLight` + `HemisphereLight` pour le sky
- `EnvironmentMap` HDR (`.hdr` ou `.exr`) pour les reflets sur la carrosserie

---

### Circuits

- Les différents circuits seront stockés dans entities/tracks/track_1, track_2 etc. Dans chaque fichier, toutes les informations permettant de génerer le circuit seront présentes : la surface du terrain, le tracé du cricuit, les barrières autour du circuit, les positions et orientations des objects d'environnement posés autour du circuit (arbres etc. stockés en fichier .glb dans public/models/), le sky background, les lights, la gravité, adhérence de la route etc.
- Les collisions Rapier sont générés automatiquement depuis les meshes via `ColliderDesc.trimesh()`
- Construire au moins **un circuit de démonstration complet** comprenant : une ligne de départ, un circuit, une ligne d'arrivée.
- Géométrie de collision dérivée du maillage du circuit (utiliser des colliders trimesh issus du glTF, ou des maillages de collision simplifiés).
- Skybox + sol pour l'environnement visuel.

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
| Changer caméra         | `C`       |

---

## Caméras

Caméra de poursuite fluide (suivi amorti par ressort) qui suit la voiture, avec une légère augmentation du champ de vision à grande vitesse pour donner une impression de vitesse.

Implémenter 3 modes de caméra toggleables avec `C` :

1. **Chase cam** (défaut) : caméra derrière la voiture avec lag (lerp position + slerp rotation), légèrement surélevée
2. **Hood cam** : caméra accrochée au capot (immersive, FPS)

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
- Delta au meilleur temps en vert/rouge selon +/-
- Keep the game loop decoupled from UI

---

## Menus

### Menu principal : 

Jouer, IA (inference/train), Editeur (de tracks).
Ne code pas la partie IA et editeur, mais affiche les dans le menu principal.

Boucle de jeu : Menu principal → Sélection de la voiture → Sélection du circuit → Chargement → Compte à rebours (3-2-1-GO) → Course → Arrivée → Résultats.

- Sélection de circuit (liste de GLB dans `public/models/tracks/`)
- Sélection de voiture (liste de GLB dans `public/models/cars/`)
- Affichage des meilleurs temps locaux (`localStorage`)

### Pause Menu (Escape)
- Resume / Restart / Retour au menu

---

## Performance

- **Game loop** : `requestAnimationFrame` avec accumulator fixe pour la physique (60Hz fixe), rendu à la fréquence native de l'écran
- **LOD** : `LOD` Three.js pour les objets décoratifs distants
- **Frustum culling** : activé par défaut sur tous les meshes décoratifs
- **Asset streaming** : `LoadingManager` avec écran de chargement (barre de progression)

- Physique à pas de temps fixe (par ex. 60 Hz) découplée de la boucle de rendu ; interpoler le rendu entre les étapes de physique.
- Viser 60 FPS sur du matériel de milieu de gamme ; inclure une petite superposition FPS/débogage (activable/désactivable à l'aide d'une touche).
- Utiliser le pool d'objets lorsque cela est pertinent ; libérer correctement les ressources Three.js.
- Le mobile n'est **pas** ciblé ; optimisation pour les navigateurs de bureau (dernières versions de Chrome).


---

## Assets de placeholder

En attendant les vrais assets GLB, générer des formes Three.js procédurales :
- **Voiture** : `BoxGeometry` pour le corps, `CylinderGeometry` pour les roues — couleurs distinctes
- **Circuit** : une boucle ovale simple générée procéduralement avec `ExtrudeGeometry` le long d'une `CatmullRomCurve3`

Cela permet de tester toute la physique et le gameplay avant d'intégrer les vrais assets.

---

## Commandes de démarrage attendues

```bash
npm install
npm run dev      # dev server Vite sur localhost:5173
npm run build    # production build dans /dist
```

## Livrables
1. Un projet entièrement exécutable (`npm install && npm run dev`) avec des ressources de remplacement afin qu'il fonctionne immédiatement.
2. Un code TypeScript propre, commenté et modulaire.
3. Un petit fichier `README.md` 
4. Un fichier `config.ts` pour régler les paramètres physiques, de caméra et graphiques.
5. `index.html` 
6. `vite.config.ts` — avec `assetsInclude: ['**/*.glb', '**/*.hdr']`, WASM support pour Rapier (`optimizeDeps`)
7. `src/main.ts` 


## Planning de développement
1. Scaffold du projet + Vite + boucle de rendu Three.js + une première scène simple.
2. Monde physique Rapier + plan de sol + véhicule raycast avec une voiture de remplacement (conduisible).
3. Caméra de poursuite + entrées clavier.
4. Chargement des pistes depuis GLB + collision + chronométrage.
5. HUD, états du jeu, compte à rebours, écran de résultats.
6. Peaufinage graphique (PBR, ombres, post-traitement) + documentation sur le remplacement des ressources.

Donnez la priorité à une **excellente sensation de conduite** ainsi qu'à un environnement graphique visuellement beau avant toute autre chose.










## Prochaines étapes : 

- Track : changements d'altitude, des virages inclinés, un saut/une rampe, et une boucle ou un boost pad si possible.
- **Plateformes de boost** et **surfaces modifiant la vitesse** (par exemple, zones à faible adhérence / de terre) en option.
- **4 roues** avec paramètres configurables : suspension travel, stiffness, damping, friction. Animation des roues : rotation de direction sur les roues avant + rotation de roulement sur toutes les roues en fonction de la vitesse.
- Ghost car (meilleur temps) : Enregistrement de la position/rotation toutes les 100ms via un `GhostRecorder`, Stockage dans `localStorage` (format JSON compressé), Replay transparent (mesh semi-transparent) pendant la course suivante.
- Effets particules : Fumée de pneus au freinage/dérapage, Poussière au dépassement des bordures
- **Système de checkpoints :** A mettre dans src/track/Checkpoint.ts. Volumes de déclenchement invisibles ; doivent être franchis dans l'ordre ; chronométrage intermédiaire (écart en temps réel par rapport au record personnel (vert/rouge)). Permettra le respawn si reset (touche R) ou si voiture retournée.
- **Prise en charge de la manette** via l'API Gamepad (direction/accélérateur analogiques) — important pour les sensations. Rendre la couche d'entrée abstraite afin que le clavier et la manette fournissent les mêmes valeurs de contrôle.
- Minimap (facultatif, top-down orthographic render sur render target séparé)
- frein arrière différentiel pour le handbrake (touche Space)
- Appui aérodynamique/traînée aérodynamique affectant la maniabilité à grande vitesse.
- Audio/Musique/Effet sonores
- Prévoir un cycle jour/nuit 
- Le circuit est un GLB unique exporté depuis Blender/Sketchfab. Nommer les meshes : `Track_Road`, `Track_Wall`, `Track_Decoration_*`, `Track_Ramp_*`
- **Contrôle de l'assiette en vol** réglage de l'assiette et du roulis en plein vol, à la manière de Trackmania.
- Respawn
- Détection de voiture retournée pendant > 2s
- Respawn au début du circuit avec vitesse nulle (animation de fondu)




## Notes d'intégration Sketchfab

Lors de l'import d'un modèle Sketchfab :
1. Télécharger en format **glTF** (pas FBX, pas OBJ)
2. Vérifier que les textures sont bien packagées dans le GLB (`Export as GLB`)
3. Dans Blender : recentrer l'origine, appliquer les transformations (`Ctrl+A → All Transforms`), réorienter si nécessaire (`Y vers le haut = Z-up dans Three.js`)
4. Exporter avec Draco compression (`Blender glTF exporter → Geometry → Draco`)




## Questions : 

TrackAI
Demander quel algorithme de Reinforcement Learning est le plus adapté à ce jeu 