## Start game

cd game
npm install
npm run dev



Todo :

- 1er circuit d’entrainement dans stade planète terre

---

## Architecture (`game/`)

Jeu de course 3D web (style Trackmania) construit avec **Vite**, **Three.js** (rendu) et **Rapier.js** (physique). Le point d'entrée `main.ts` orchestre les systèmes persistants ; chaque course est encapsulée dans une `RaceSession` jetable.

### Stack

| Couche      | Technologie                                 |
| ----------- | ------------------------------------------- |
| Build       | Vite + TypeScript                           |
| Rendu       | Three.js (WebGL, post-processing optionnel) |
| Physique    | Rapier 3D (WASM, véhicule raycast)          |
| UI          | DOM + CSS (`ui/`)                           |
| Persistance | `localStorage` (meilleurs temps)            |
| IA (prévu)  | WebSocket → serveur Python (`ai/`)          |


### Flux applicatif

```mermaid
stateDiagram-v2
    [*] --> menu
    menu --> vehicleSelect : Jouer
    vehicleSelect --> trackSelect : Suivant
    trackSelect --> vehicleSelect : Retour
    vehicleSelect --> menu : Retour
    trackSelect --> loading : Démarrer
    loading --> racing : RaceSession créée
    racing --> paused : Échap
    paused --> racing : Reprendre
    paused --> loading : Recommencer
    paused --> menu : Menu
    racing --> results : Course terminée
    results --> loading : Recommencer
    results --> menu : Menu
    menu --> [*]
```

### Architecture runtime

```mermaid
flowchart TB
    subgraph bootstrap["Bootstrap"]
        HTML[index.html]
        MAIN[main.ts / App]
        INIT[initPhysics]
    end

    subgraph persistent["Systèmes persistants (durée de vie App)"]
        LOOP[GameLoop]
        INPUT[InputManager]
        SCENE[SceneManager]
        CAM[CameraController]
        LIGHT[Lighting]
        POST[PostProcessing]
        UI[Menus · HUD · Countdown · Debug]
    end

    subgraph session["RaceSession (par course)"]
        PW[PhysicsWorld]
        TF[TrackConstructor → BuiltTrack]
        VC[VehicleController]
        VV[VehicleView]
        RACE[Race]
        CTRL[Controller]
    end

    subgraph data["Données"]
        CARS[cars/data]
        TRACKS[tracks/data]
        CFG[config.ts]
        STORE[Storage / localStorage]
    end

    HTML --> MAIN
    MAIN --> INIT
    MAIN --> persistent
    MAIN -->|"startRace()"| session

    CARS --> VC
    CARS --> VV
    TRACKS --> TF
    CFG --> LOOP
    CFG --> RACE
    STORE --> RACE

    INPUT --> CTRL
    CTRL -->|ControlState| VC
    VC --> PW
    TF --> PW
    TF --> SCENE
    VV --> SCENE

    LOOP -->|fixedUpdate dt| session
    LOOP -->|render alpha| MAIN
    MAIN --> CAM
    MAIN --> POST
    MAIN --> UI
    RACE --> UI
```

### Boucle de jeu

La simulation physique tourne à **pas fixe** (60 Hz) ; le rendu suit la fréquence d'affichage avec **interpolation** (`alpha`) entre deux états physiques.

```mermaid
sequenceDiagram
    participant GL as GameLoop
    participant App as main.ts
    participant RS as RaceSession
    participant VC as VehicleController
    participant PW as PhysicsWorld
    participant R as Race
    participant Cam as CameraController
    participant PP as PostProcessing

    loop Chaque frame (rAF)
        GL->>GL: accumulator += frameDt
        loop Tant que accumulator ≥ fixedStep
            GL->>App: fixedUpdate(dt)
            App->>RS: fixedUpdate(dt, isRacing)
            RS->>RS: controller.sample()
            RS->>VC: update(control, dt)
            RS->>PW: step()
            RS->>R: update(dt, trackProgress)
            RS->>RS: buffers interpolation prev/curr
        end
        GL->>App: render(alpha, frameDt)
        App->>RS: render(alpha)
        RS->>RS: lerp position / rotation châssis
        App->>Cam: update(renderPos, speed)
        App->>PP: render() ou SceneManager.render()
    end
```

### Couplage des responsabilités

| Module              | Rôle                                                                                         |
| ------------------- | -------------------------------------------------------------------------------------------- |
| `main.ts`           | Machine à états UI, cycle de vie des sessions, câblage global                                |
| `RaceSession`       | Frontière simulation/rendu : construit le monde, avance la physique, expose l'état interpolé |
| `Controller`        | Découple l'entrée (humain / IA) de `VehicleController` via `ControlState`                    |
| `TrackConstructor`  | Visuel + colliders + courbe centrale + spawn + progression sur piste                         |
| `Race`              | Règles de course (tours, chrono, delta, records) indépendantes de la physique                |
| `VehicleController` | Seul module qui parle à Rapier pour le véhicule                                              |
| `VehicleView`       | Représentation Three.js synchronisée avec la physique                                        |

### Intégration IA (prévue)

```mermaid
flowchart LR
    RS[RaceSession] -->|VehicleObservation| AIC[AIController]
    AIC -->|WebSocket JSON| PY[Serveur Python / ai/]
    PY -->|action throttle steer…| AIC
    AIC -->|ControlState| VC[VehicleController]
```

Chaque frame, `RaceSession` peut pousser une observation (position, capteurs raycast, progression) vers `AIController`, qui relaie les actions reçues du serveur externe.