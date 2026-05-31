Here's a comprehensive prompt you can forward to Claude Code:

---

# Build a Browser-Based Single-Player Racing Game (Trackmania-style)

## Project Overview
Build a **single-player, browser-based 3D car racing game** inspired by **Trackmania**. The focus is on tight, arcade-leaning-but-realistic driving physics, time-attack gameplay, and polished 3D graphics using external assets (Blender exports + Sketchfab models). No multiplayer, no backend account system required.

## Core Tech Stack
- **Language:** TypeScript (strict mode).
- **Build tool:** Vite.
- **3D engine:** Three.js (latest stable) for rendering.
- **Physics:** Rapier (`@dimforge/rapier3d-compat`) — use its raycast vehicle controller for realistic-but-tunable car physics.
- **Asset format:** glTF/GLB (the standard Blender + Sketchfab export). Use Draco/Meshopt compression for meshes.
- **State/UI:** Lightweight — vanilla TS + HTML/CSS overlay, or a minimal framework if justified. Keep the game loop decoupled from UI.
- **No server required** for gameplay; persist data via `localStorage`/`IndexedDB`.

## Project Structure
Organize cleanly, e.g.:
```
src/
  core/        (game loop, time step, input manager)
  physics/     (Rapier world setup, vehicle controller)
  rendering/   (Three.js scene, camera, lighting, post-processing)
  entities/    (car, track, checkpoints)
  assets/      (asset loader, glTF management)
  game/        (game states, race logic, timing, scoring)
  ui/          (HUD, menus, leaderboard)
  utils/
public/
  models/      (.glb car + track assets)
  textures/
```

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

## Car Physics Requirements (the heart of the game)
Implement realistic, satisfying vehicle dynamics using a **raycast vehicle model**:
- Per-wheel suspension (spring + damper), configurable ride height and stiffness.
- Tire friction model with separate longitudinal/lateral grip; support controlled oversteer/drift.
- Engine model: acceleration curve, top speed, simple gear/torque approximation.
- Braking + handbrake (handbrake reduces rear grip for drifting).
- Steering with speed-sensitive steer angle reduction.
- Downforce/aerodynamic drag affecting high-speed handling.
- Air control while airborne (Trackmania-style mid-air pitch/roll adjustment) — make this tunable.
- Reset/respawn-to-last-checkpoint button (e.g. `R` / `Enter`), and full restart (`Backspace`).
- Expose all key physics params in a single tunable config object so handling can be iterated quickly.

## Tracks & Environment
- Build at least **one complete demo track** with: start line, multiple checkpoints (ordered), a finish line, plus elevation changes, banked turns, a jump/ramp, and a loop or boost pad if feasible.
- Collision geometry derived from track mesh (use trimesh colliders from the glTF, or simplified collision meshes).
- **Checkpoint system:** invisible trigger volumes; must be passed in order; track split times.
- **Boost pads** and optional **speed-modifier surfaces** (e.g. low-grip / dirt zones) as Trackmania-style elements.
- Skybox + ground/environment for visual context.

## Graphics & Assets
- Load 3D car and track assets as **GLB files** via Three.js `GLTFLoader` (with `DRACOLoader`/`MeshoptDecoder`).
- Provide a clean **asset-loading pipeline** with a loading screen + progress bar.
- Since I'll supply real assets from Blender/Sketchfab later, **scaffold with placeholder primitives** (a box car + simple track) that can be swapped for GLBs by changing only the asset config/paths. Document the expected model conventions (scale in meters, +Y up, origin placement, wheel naming convention so wheels can be found and animated).
- Graphics quality target: PBR materials, realtime shadows, decent lighting (directional sun + ambient/IBL via an HDR environment map).
- **Post-processing:** subtle bloom, motion blur or speed-effect at high velocity, optional SSAO. Keep it toggleable for performance.
- Animate wheels: steering rotation on front wheels + rolling rotation on all wheels matched to speed.

## Camera
- Smooth chase camera (spring-damped follow) that trails behind the car, with slight FOV increase at speed for a sense of velocity.
- Allow camera modes: chase, hood/cockpit, and a free orbit (for debugging/replay).

## Gameplay Loop & Features
- **Game states:** Main Menu → Track Select → Loading → Countdown (3-2-1-GO) → Racing → Finish → Results.
- **Timing:** millisecond-precise lap/run timer, per-checkpoint split times, live delta vs. personal best (green/red).
- **HUD:** current time, speed (km/h), checkpoint progress, current vs best delta.
- **Ghost replay (highly desired):** record the player's best run (position/rotation per frame) and replay it as a semi-transparent ghost car to race against. Persist best ghost in `localStorage`/`IndexedDB`.
- **Personal best leaderboard** stored locally.
- Pause menu (Esc) with resume/restart/quit.

## Controls
- Keyboard (WASD / Arrow keys), Space = handbrake, R = respawn to checkpoint, Esc = pause.
- **Gamepad support** via the Gamepad API (analog steering/throttle) — important for feel.
- Make the input layer abstract so keyboard and gamepad feed the same control values.

## Performance & Quality
- Fixed-timestep physics (e.g. 60 Hz) decoupled from render loop; interpolate rendering between physics steps.
- Target 60 FPS on mid-range hardware; include a small FPS/debug overlay (toggle with a key).
- Use object pooling where relevant; dispose of Three.js resources properly.
- Mobile is **not** a priority; optimize for desktop browsers (Chrome/Firefox/Safari latest).

## Deliverables
1. A fully runnable project (`npm install && npm run dev`) with placeholder assets so it works immediately.
2. Clean, commented, modular TypeScript code.
3. A `README.md` covering: how to run, how to swap in my own Blender/Sketchfab GLB assets (naming/scale conventions), where to tune physics, and how to add new tracks.
4. A central `config.ts` for tuning physics, camera, and graphics settings.

## Build Order (please proceed in phases, confirming each works)
1. Project scaffold + Vite + Three.js render loop + a spinning placeholder scene.
2. Rapier physics world + ground plane + raycast vehicle with placeholder box car (drivable).
3. Chase camera + input (keyboard + gamepad).
4. Track loading from GLB + collision + checkpoints + timing.
5. HUD, game states, countdown, results screen.
6. Ghost replay + local leaderboard.
7. Graphics polish (PBR, shadows, post-processing) + asset-swap documentation.

Start with phase 1 and a clear plan, then build incrementally. Prioritize **great driving feel** above everything else.

---

Want me to tailor this further — e.g. lock in a specific physics engine, add a track editor, or target a particular art style — before you send it?