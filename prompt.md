# Prompt — Jeu de voiture web style Trackmania (local, single-player)

## Contexte et objectif

Développe un jeu de voiture 3D dans le navigateur, **single-player, entièrement local**, inspiré de Trackmania : circuits en boucle chronométrés, physique réaliste, sensation de vitesse, support d'assets 3D importés depuis Blender/Sketchfab. Le jeu doit tourner entièrement en frontend (HTML + JS), sans backend.

---

## Stack technique obligatoire

| Couche | Choix |
|--------|-------|
| Rendu 3D | **Three.js** (r165+) |
| Physique | **Rapier.js** (WASM) — moteur rigide, véhicule à contraintes, collision précise |
| Format assets 3D | **glTF 2.0 / GLB** (export Blender → glTF, Sketchfab → glTF) |
| Chargeur d'assets | `GLTFLoader` (Three.js) + `DRACOLoader` pour la compression des géométries |
| Bundler | **Vite** |
| Langage | **TypeScript** (strict mode) |
| Gestion des inputs | `KeyboardEvent` + support gamepad via `Gamepad API` (optionnel mais conseillé) |

### Dépendances npm
```json
{
  "dependencies": {
    "three": "^0.165.0",
    "@dimforge/rapier3d": "^0.12.0",
    "lil-gui": "^0.19.0"
  },
  "devDependencies": {
    "vite": "^5.0.0",
    "typescript": "^5.4.0",
    "@types/three": "^0.165.0"
  }
}
```

---

## Architecture du projet

```
/
├── public/
│   └── assets/
│       ├── models/          # GLB : voiture, éléments de circuit
│       ├── textures/        # PNG/KTX2 : routes, décors
│       └── audio/           # OGG : moteur, ambiance
├── src/
│   ├── main.ts              # Entry point, init Three.js + Rapier
│   ├── engine/
│   │   ├── Renderer.ts      # Three.js WebGLRenderer, post-processing
│   │   ├── Physics.ts       # Rapier world, update loop
│   │   └── AssetLoader.ts   # GLTFLoader, cache, progression
│   ├── vehicle/
│   │   ├── Car.ts           # Mesh 3D + RigidBody Rapier
│   │   ├── VehiclePhysics.ts # Contraintes roues (Rapier VehicleController)
│   │   └── InputController.ts
│   ├── track/
│   │   ├── Track.ts         # Chargement du circuit GLB, colliders statiques
│   │   ├── Checkpoint.ts    # Zones de passage (triggers Rapier)
│   │   └── RaceTimer.ts
│   ├── ui/
│   │   ├── HUD.ts           # Speedomètre, timer, lap counter (DOM overlay)
│   │   ├── MainMenu.ts
│   │   └── GhostRecorder.ts # Enregistrement et replay du meilleur temps
│   └── utils/
│       ├── EventEmitter.ts
│       └── MathUtils.ts
├── index.html
├── vite.config.ts
└── tsconfig.json
```

---

## Physique véhicule (priorité haute)

Utilise le **`VehicleController` de Rapier.js** (implémentation Raycast Vehicle, standard AAA) :

- **4 roues** avec paramètres configurables : suspension travel, stiffness, damping, friction
- **Steering** : angle max ≈ 35°, retour au centre progressif (`lerpAngle`)
- **Moteur** : courbe de couple non-linéaire (torque map), couple maximal à régime intermédiaire
- **Frein/dérapage** : frein arrière différentiel pour le handbrake, friction latérale réaliste
- **Centre de gravité** bas et configurable** pour éviter le retournement

Paramètres de base à exposer dans un fichier `vehicleConfig.ts` :
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

### Renderer
```ts
renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = PCFSoftShadowMap;
renderer.toneMapping = ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;
renderer.outputColorSpace = SRGBColorSpace;
```

### Post-processing (via `three/examples/jsm/postprocessing`)
- **Bloom** léger (seuil haut) pour les feux et reflets
- **SSAO** (Screen Space Ambient Occlusion) pour la profondeur
- **Motion Blur** (velocity-based) pour la sensation de vitesse

### Éclairage
- `DirectionalLight` principal avec `CastShadow` (soleil)
- `AmbientLight` + `HemisphereLight` pour le sky
- `EnvironmentMap` HDR (`.hdr` ou `.exr`) pour les reflets sur la carrosserie
- Prévoir un cycle jour/nuit toggle

### Effets particules
- Fumée de pneus au freinage/dérapage (`Points` system)
- Poussière au dépassement des bordures

---

## Import d'assets 3D

### Convention de nommage GLB (Blender)
Toutes les parties de la voiture doivent être nommées selon cette convention dans Blender avant export :
```
Car_Body          → mesh principal
Car_Wheel_FL      → roue avant gauche
Car_Wheel_FR      → roue avant droite
Car_Wheel_RL      → roue arrière gauche
Car_Wheel_RR      → roue arrière droite
Car_Window_*      → vitres (shader transparent)
```

### Chargement voiture
```ts
async function loadCar(path: string): Promise<CarMeshParts> {
  const gltf = await loader.loadAsync(path);
  const body = gltf.scene.getObjectByName('Car_Body');
  const wheels = ['FL','FR','RL','RR'].map(
    s => gltf.scene.getObjectByName(`Car_Wheel_${s}`)
  );
  // Appliquer PBR materials depuis les textures du GLB
  return { body, wheels };
}
```

### Circuit (Track)
- Le circuit est un GLB unique exporté depuis Blender
- Nommer les meshes : `Track_Road`, `Track_Wall`, `Track_Decoration_*`, `Track_Ramp_*`
- Les colliders Rapier sont générés automatiquement depuis les meshes `Track_Road` et `Track_Wall` via `ColliderDesc.trimesh()`
- Les checkpoints sont des objets vides nommés `Checkpoint_00`, `Checkpoint_01`... dans le GLB (positions lues, pas rendus)

---

## Gameplay — mécaniques Trackmania

### Timer et checkpoints
- Timer visible dès le départ (format `mm:ss.mmm`)
- Circuit en boucle : passage par tous les checkpoints dans l'ordre requis
- Compteur de tours (ex : 3 laps)
- Affichage du delta au meilleur temps précédent (+/- XX.XXX)

### Ghost car (meilleur temps)
- Enregistrement de la position/rotation toutes les 100ms via un `GhostRecorder`
- Stockage dans `localStorage` (format JSON compressé)
- Replay transparent (mesh semi-transparent) pendant la course suivante

### Respawn
- Détection de voiture retournée (`upVector.dot(worldUp) < 0.3` pendant > 2s)
- Respawn sur le dernier checkpoint avec vitesse nulle (animation de fondu)

### Reset instantané
- Touche `R` → replace la voiture au dernier checkpoint immédiatement

---

## Contrôles

| Action | Clavier | Gamepad |
|---|---|---|
| Accélérer | `W` / `↑` | Gâchette droite (R2/RT) |
| Freiner/Marche arrière | `S` / `↓` | Gâchette gauche (L2/LT) |
| Tourner gauche | `A` / `←` | Stick gauche |
| Tourner droite | `D` / `→` | Stick gauche |
| Frein à main | `Space` | Bouton X/A |
| Reset position | `R` | Bouton Y/Triangle |
| Pause | `Escape` | Start |
| Changer caméra | `C` | Bouton B/Cercle |

---

## Caméras

Implémenter 3 modes de caméra toggleables avec `C` :

1. **Chase cam** (défaut) : caméra derrière la voiture avec lag (lerp position + slerp rotation), légèrement surélevée
2. **Hood cam** : caméra accrochée au capot (immersive, FPS)
3. **Free orbit** : `OrbitControls` pour spectator/debug

---

## HUD (DOM overlay, pas Three.js)

Interface overlay en HTML/CSS positionné en absolute sur le canvas :

```
┌─────────────────────────────────┐
│  LAP 2/3          00:01:23.456  │
│  BEST  00:01:19.002  △+04.454   │
│                                 │
│                         185 km/h│
│                        [====  ] │  ← speedometer arc SVG
└─────────────────────────────────┘
```

- Speedomètre en arc SVG animé
- Delta au meilleur temps en vert/rouge selon +/-
- Minimap (facultatif, top-down orthographic render sur render target séparé)

---

## Menus

### Main Menu
- Sélection de circuit (liste de GLB dans `public/assets/models/tracks/`)
- Sélection de voiture (liste de GLB dans `public/assets/models/cars/`)
- Affichage des meilleurs temps locaux (`localStorage`)

### Pause Menu (Escape)
- Resume / Restart / Retour au menu

---

## Performance

- **Game loop** : `requestAnimationFrame` avec accumulator fixe pour la physique (60Hz fixe), rendu à la fréquence native de l'écran
- **LOD** : `LOD` Three.js pour les objets décoratifs distants
- **Frustum culling** : activé par défaut sur tous les meshes décoratifs
- **Asset streaming** : `LoadingManager` avec écran de chargement (barre de progression)
- Cible : **60fps stable** sur GPU mid-range (GTX 1060 / RX 580 équivalent)

---

## Structure de la game loop

```ts
// Physique : pas fixe à 60Hz
const PHYSICS_STEP = 1 / 60;
let accumulator = 0;

function gameLoop(timestamp: number) {
  const dt = Math.min((timestamp - lastTime) / 1000, 0.05); // cap à 50ms
  lastTime = timestamp;
  accumulator += dt;

  while (accumulator >= PHYSICS_STEP) {
    inputController.update();
    vehiclePhysics.update(PHYSICS_STEP);
    rapierWorld.step();
    accumulator -= PHYSICS_STEP;
  }

  // Interpolation pour le rendu
  const alpha = accumulator / PHYSICS_STEP;
  car.interpolate(alpha);

  renderer.render(scene, activeCamera);
  requestAnimationFrame(gameLoop);
}
```

---

## Fichiers de démarrage à générer

1. `index.html` — canvas plein écran + div HUD overlay + loading screen
2. `vite.config.ts` — avec `assetsInclude: ['**/*.glb', '**/*.hdr']`, WASM support pour Rapier (`optimizeDeps`)
3. `src/main.ts` — init complète, scene setup, lumières, démarrage game loop
4. `src/engine/Physics.ts` — init Rapier WASM, création du world
5. `src/vehicle/VehiclePhysics.ts` — implémentation complète du VehicleController Rapier
6. `src/track/Track.ts` — chargement GLB + génération trimesh colliders
7. `src/ui/HUD.ts` — DOM overlay avec speedomètre SVG et timer

---

## Assets de placeholder

En attendant les vrais assets GLB, générer des formes Three.js procédurales :
- **Voiture** : `BoxGeometry` pour le corps, `CylinderGeometry` pour les roues — couleurs distinctes
- **Circuit** : une boucle ovale simple générée procéduralement avec `ExtrudeGeometry` le long d'une `CatmullRomCurve3`

Cela permet de tester toute la physique et le gameplay avant d'intégrer les vrais assets.

---

## Notes d'intégration Sketchfab

Lors de l'import d'un modèle Sketchfab :
1. Télécharger en format **glTF** (pas FBX, pas OBJ)
2. Vérifier que les textures sont bien packagées dans le GLB (`Export as GLB`)
3. Dans Blender : recentrer l'origine, appliquer les transformations (`Ctrl+A → All Transforms`), réorienter si nécessaire (`Y vers le haut = Z-up dans Three.js`)
4. Exporter avec Draco compression (`Blender glTF exporter → Geometry → Draco`)

---

## Commandes de démarrage attendues

```bash
npm install
npm run dev      # dev server Vite sur localhost:5173
npm run build    # production build dans /dist
npm run preview  # preview du build prod
```


J'aimerais faire un jeu vidéo de voiture web (dans le navigateur) en local (sans multijoueur), fais moi un prompt que je peux envoyer à Claude Code avec toutes les spécifications techniques que tu penses être nécessaires. Ce jeu dois être dans le style trackmania, la physique doit etre réaliste, les graphismes seront assez détaillés (on va utiliser des assets 3D depuis blender et sketchfab).