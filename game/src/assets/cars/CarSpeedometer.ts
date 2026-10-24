import * as THREE from 'three';

// Segments: top, upper right, lower right, bottom, lower left, upper left, middle.
const DIGIT_MASKS = [63, 6, 91, 79, 102, 109, 125, 7, 127, 111];

/** Remove the three raised static glyphs, which use separate UV islands. */
function removeStaticDigits(mesh: THREE.Mesh): void {
  const source = mesh.geometry;
  const position = source.getAttribute('position');
  const uv = source.getAttribute('uv');
  if (!position || !uv) return;

  // Coordinates in the unscaled Trackmania GLB mesh, before import transforms.
  // The backing panel uses U ~0.29-0.31; the raised glyphs use U ~0.39-0.74.
  // Both spatial bounds and UVs are required to preserve the panel and trim.
  const isStaticDigit = (index: number): boolean =>
    Math.abs(position.getX(index)) < 15
    && position.getY(index) > 28 && position.getY(index) < 40.5
    && position.getZ(index) > -146 && position.getZ(index) < -137
    && uv.getX(index) > 0.35;

  const index = source.index;
  const count = index?.count ?? position.count;
  const kept: number[] = [];
  for (let i = 0; i < count; i += 3) {
    const a = index ? index.getX(i) : i;
    const b = index ? index.getX(i + 1) : i + 1;
    const c = index ? index.getX(i + 2) : i + 2;
    if (isStaticDigit(a) && isStaticDigit(b) && isStaticDigit(c)) continue;
    kept.push(a, b, c);
  }
  if (kept.length === count) return;
  // Geometry is shared with the asset cache and other cars. Change this clone.
  mesh.geometry = source.clone();
  mesh.geometry.setIndex(kept);
}

/** Replaces the three baked digits in the Trackmania Details texture atlas. */
export class CarSpeedometer {
  private readonly segments = { value: new THREE.Vector3() };
  private speed = -1;

  constructor(model: THREE.Object3D, materialName: string) {
    // GLB clones share materials. Each car needs its own speed uniform, including
    // when a garage preview and several racing agents use the same cached model.
    const materials = new Map<THREE.Material, THREE.Material>();
    model.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      if (!Array.isArray(object.material) && object.material.name === materialName) {
        removeStaticDigits(object);
      }
      const prepare = (original: THREE.Material): THREE.Material => {
        if (original.name !== materialName || !(original instanceof THREE.MeshStandardMaterial)) return original;
        let material = materials.get(original);
        if (material) return material;
        material = original.clone();
        material.customProgramCacheKey = () => 'trackmania-speedometer-v2';
        material.onBeforeCompile = shader => {
          shader.uniforms.speedometerSegments = this.segments;
          shader.vertexShader = shader.vertexShader
            .replace('#include <common>', '#include <common>\nvarying vec2 vSpeedometerUv;')
            .replace('#include <uv_vertex>', '#include <uv_vertex>\nvSpeedometerUv = uv;');
          shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', `#include <common>
varying vec2 vSpeedometerUv;
uniform vec3 speedometerSegments;

float speedometerBar(vec2 p, vec2 center, vec2 halfSize) {
  vec2 distanceToEdge = abs(p - center) - halfSize;
  vec2 smoothing = max(fwidth(p), vec2(0.001));
  vec2 coverage = 1.0 - smoothstep(-smoothing, smoothing, distanceToEdge);
  return coverage.x * coverage.y;
}

float speedometerDigit(vec2 p, float mask) {
  float light = 0.0;
  light += mod(floor(mask / 1.0), 2.0) * speedometerBar(p, vec2(0.5, 0.9), vec2(0.28, 0.055));
  light += mod(floor(mask / 2.0), 2.0) * speedometerBar(p, vec2(0.83, 0.7), vec2(0.065, 0.15));
  light += mod(floor(mask / 4.0), 2.0) * speedometerBar(p, vec2(0.83, 0.3), vec2(0.065, 0.15));
  light += mod(floor(mask / 8.0), 2.0) * speedometerBar(p, vec2(0.5, 0.1), vec2(0.28, 0.055));
  light += mod(floor(mask / 16.0), 2.0) * speedometerBar(p, vec2(0.17, 0.3), vec2(0.065, 0.15));
  light += mod(floor(mask / 32.0), 2.0) * speedometerBar(p, vec2(0.17, 0.7), vec2(0.065, 0.15));
  light += mod(floor(mask / 64.0), 2.0) * speedometerBar(p, vec2(0.5, 0.5), vec2(0.28, 0.055));
  return min(light, 1.0);
}`)
            .replace('#include <map_fragment>', `#include <map_fragment>
// The atlas is rotated: decreasing V reads left to right from behind the car;
// increasing U goes up. Coordinates are measured on the original GLB UVs.
vec2 speedometerUv = vec2(
  (0.2863 - vSpeedometerUv.y) / (0.2863 - 0.2223),
  (vSpeedometerUv.x - 0.2923) / (0.3094 - 0.2923)
);
float speedometerArea = step(0.0, speedometerUv.x) * step(speedometerUv.x, 1.0)
  * step(0.0, speedometerUv.y) * step(speedometerUv.y, 1.0);
float speedometerSlot = min(floor(speedometerUv.x * 3.0), 2.0);
float speedometerMask = speedometerSlot < 0.5 ? speedometerSegments.x
  : (speedometerSlot < 1.5 ? speedometerSegments.y : speedometerSegments.z);
float speedometerLight = speedometerArea * speedometerDigit(
  vec2(fract(speedometerUv.x * 3.0), speedometerUv.y), speedometerMask
);`)
            .replace('#include <opaque_fragment>', `
// The original digits also affect normals, metalness and reflected lighting.
// Replace the final shaded color with an unlit screen in this region so none
// of those baked/embossed contours can show through the dynamic digits.
vec3 speedometerColor = mix(vec3(0.001, 0.006, 0.012), vec3(0.65, 0.9, 1.0), speedometerLight);
outgoingLight = mix(outgoingLight, speedometerColor, speedometerArea);
#include <opaque_fragment>`);
        };
        materials.set(original, material);
        return material;
      };
      object.material = Array.isArray(object.material)
        ? object.material.map(prepare)
        : prepare(object.material);
    });
    this.update(0);
  }

  update(speedKmh: number): void {
    const speed = Number.isFinite(speedKmh) ? Math.min(999, Math.round(Math.abs(speedKmh))) : 0;
    if (speed === this.speed) return;
    this.speed = speed;
    this.segments.value.set(
      DIGIT_MASKS[Math.floor(speed / 100)],
      DIGIT_MASKS[Math.floor(speed / 10) % 10],
      DIGIT_MASKS[speed % 10],
    );
  }
}
