/**
 * Lighting configure le ciel et l'éclairage d'une scène à partir d'une
 * définition de circuit (soleil directionnel + ombres, ambiance, hémisphère).
 */
import * as THREE from 'three';
import { GRAPHICS_CONFIG } from '../config';
import type { TrackLighting } from '../assets/tracks/types';

/** Camera-relative sky: no panorama assets and no per-frame allocations. */
function createSunsetSky(): THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial> {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      zenithColor: { value: new THREE.Color(0x719dc1) },
      horizonColor: { value: new THREE.Color(0xe0e1d1) },
      lowerColor: { value: new THREE.Color(0xbac7b5) },
      sunsetColor: { value: new THREE.Color(0xf6d4aa) },
      cloudColor: { value: new THREE.Color(0xfff4e4) },
      sunDirection: { value: new THREE.Vector3() },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDirection;
      void main() {
        vDirection = position;
        // Only camera rotation applies, so the sky stays infinitely far away.
        vec4 viewPosition = vec4(mat3(viewMatrix) * position, 1.0);
        gl_Position = projectionMatrix * viewPosition;
        gl_Position.z = gl_Position.w;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 zenithColor;
      uniform vec3 horizonColor;
      uniform vec3 lowerColor;
      uniform vec3 sunsetColor;
      uniform vec3 cloudColor;
      uniform vec3 sunDirection;
      varying vec3 vDirection;

      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
      }
      float noise(vec2 p) {
        vec2 cell = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(cell), hash(cell + vec2(1.0, 0.0)), f.x),
                   mix(hash(cell + vec2(0.0, 1.0)), hash(cell + vec2(1.0)), f.x), f.y);
      }
      float cloudNoise(vec2 p) {
        return noise(p) * 0.57 + noise(p * 2.03 + 7.0) * 0.28
             + noise(p * 4.07 + 19.0) * 0.15;
      }
      void main() {
        vec3 direction = normalize(vDirection);
        float elevation = max(direction.y, 0.0);
        vec3 sky = mix(horizonColor, zenithColor, pow(elevation, 0.45));
        sky = mix(sky, lowerColor, smoothstep(0.0, 0.22, -direction.y));

        float alignment = max(dot(direction, sunDirection), 0.0);
        float warmHaze = pow(alignment, 5.0) * exp(-elevation * 2.0);
        sky = mix(sky, sunsetColor, warmHaze * 0.38);

        // Three octaves suffice for quiet, elongated high clouds.
        vec2 cloudUv = direction.xz / max(direction.y + 0.24, 0.12);
        cloudUv = cloudUv * vec2(2.6, 7.5) + vec2(2.0, 7.0);
        float clouds = smoothstep(0.53, 0.78, cloudNoise(cloudUv));
        clouds *= smoothstep(0.035, 0.18, elevation);
        clouds *= 1.0 - smoothstep(0.72, 0.97, elevation);
        sky = mix(sky, cloudColor, clouds * 0.32);

        float halo = pow(alignment, 180.0);
        float disc = smoothstep(0.99982, 0.99992, alignment);
        sky = mix(sky, sunsetColor, halo * 0.28);
        sky = mix(sky, vec3(1.0, 0.94, 0.76), disc * 0.95);
        gl_FragColor = vec4(sky, 1.0);
        #include <colorspace_fragment>
      }
    `,
    side: THREE.BackSide,
    depthWrite: false,
    toneMapped: false,
    fog: false,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), material);
  sky.name = 'Sunset atmosphere';
  sky.frustumCulled = false;
  sky.renderOrder = -1000;
  sky.visible = false;
  return sky;
}

export class Lighting {
  private readonly sun: THREE.DirectionalLight;
  private readonly ambient: THREE.AmbientLight;
  private readonly hemi: THREE.HemisphereLight;
  private readonly group = new THREE.Group();
  private readonly sky = createSunsetSky();
  private readonly sunOffset = new THREE.Vector3();

  constructor(private readonly scene: THREE.Scene) {
    this.sun = new THREE.DirectionalLight(0xffffff, 3.0);
    this.sun.castShadow = GRAPHICS_CONFIG.shadows;
    this.sun.shadow.mapSize.set(GRAPHICS_CONFIG.shadowMapSize, GRAPHICS_CONFIG.shadowMapSize);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 600;
    const d = 160;
    this.sun.shadow.camera.left = -d;
    this.sun.shadow.camera.right = d;
    this.sun.shadow.camera.top = d;
    this.sun.shadow.camera.bottom = -d;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;

    this.ambient = new THREE.AmbientLight(0xffffff, 0.4);
    this.hemi = new THREE.HemisphereLight(0xbfd8ff, 0x586247, 0.6);

    this.group.add(this.sun, this.sun.target, this.ambient, this.hemi, this.sky);
    scene.add(this.group);
  }

  apply(lighting: TrackLighting): void {
    const sunDir = new THREE.Vector3(lighting.sunDirection.x, lighting.sunDirection.y, lighting.sunDirection.z).normalize();
    this.sun.position.copy(sunDir.clone().multiplyScalar(180));
    this.sun.target.position.set(0, 0, 0);
    this.sun.intensity = lighting.sunIntensity;
    this.sun.color.set(lighting.sunColor);
    this.ambient.intensity = lighting.ambientIntensity;
    this.ambient.color.set(lighting.ambientColor);
    this.hemi.color.set(lighting.skyColor);
    this.hemi.groundColor.set(lighting.groundColor);
    this.hemi.intensity = lighting.hemiIntensity;
    this.sky.visible = lighting.skyStyle === 'sunset';
    this.sky.material.uniforms.sunDirection.value.copy(sunDir);

    // Ciel + brouillard assortis.
    this.scene.background = new THREE.Color(lighting.skyColor);
    this.scene.fog = new THREE.Fog(
      lighting.fogColor ?? lighting.skyColor,
      lighting.fogNear ?? GRAPHICS_CONFIG.fogNear,
      lighting.fogFar ?? GRAPHICS_CONFIG.fogFar,
    );
  }

  /** Fait suivre l'ombre du soleil à la voiture (pour garder une ombre nette). */
  followTarget(pos: THREE.Vector3): void {
    this.sunOffset.subVectors(this.sun.position, this.sun.target.position);
    this.sun.target.position.copy(pos);
    this.sun.position.copy(pos).add(this.sunOffset);
  }

  dispose(): void {
    this.scene.remove(this.group);
    this.sun.dispose();
    this.ambient.dispose();
    this.hemi.dispose();
    this.sky.geometry.dispose();
    this.sky.material.dispose();
  }
}
