# Trackmania France

Imported from the user-provided Sketchfab download `trackmania_2020_custom_skin_-_france.glb` (1k textures).

The integrated GLB preserves the original materials and textures. Each complete wheel assembly (tires, rims and inner details from the Wheels, Details and Skin materials) is grouped under `Wheel_FL`, `Wheel_FR`, `Wheel_RL`, or `Wheel_RR`, with its origin at the tire center. The suspension links remain attached to the body. The `full` animation mode follows the suspension, steers the front wheels and rolls all four wheels using the physics axle angles.

To regenerate it from the original download, run from `game/`:

```sh
node scripts/prepare-trackmania-france.mjs /path/to/trackmania_2020_custom_skin_-_france.glb
```

Dimensions, physics wheel anchors and visual offsets are configured in `src/assets/cars/data/car_3.ts`. The driving parameters derive from the training car.
