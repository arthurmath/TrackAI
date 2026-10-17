# Trackmania France

Imported from the user-provided Sketchfab download `trackmania_2020_custom_skin_-_france.glb` (1k textures).

The integrated GLB preserves the original materials and textures. Its merged wheel mesh has been separated into `Wheel_FL`, `Wheel_FR`, `Wheel_RL`, and `Wheel_RR`, allowing independent front steering. Wheel rolling and suspension animation are not enabled; the model uses the existing `steer-only` animation mode.

To regenerate it from the original download, run from `game/`:

```sh
node scripts/prepare-trackmania-france.mjs /path/to/trackmania_2020_custom_skin_-_france.glb
```

Dimensions, physics wheel anchors and visual offsets are configured in `src/assets/cars/data/car_3.ts`. The driving parameters derive from the training car.
