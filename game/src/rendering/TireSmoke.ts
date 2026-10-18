import * as THREE from 'three';
import type { TireSmokeSource } from '../physics/VehicleController';

const CAPACITY = 2048;

interface Puff {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  age: number;
  lifetime: number;
  size: number;
  opacity: number;
}

/** Pool partagé par la course : un seul draw call, sans texture externe. */
export class TireSmoke {
  private readonly opacity = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY), 1);
  private readonly geometry = new THREE.PlaneGeometry(1, 1);
  private readonly material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog]),
    fog: true,
    vertexShader: `
      attribute float smokeOpacity;
      varying vec2 vUv;
      varying float vOpacity;
      #include <fog_pars_vertex>
      void main() {
        vUv = uv;
        vOpacity = smokeOpacity;
        vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        // Quads orientés vers la caméra, taille exprimée en mètres.
        mvPosition.xy += position.xy * instanceMatrix[0][0];
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: `
      varying vec2 vUv;
      varying float vOpacity;
      #include <fog_pars_fragment>
      void main() {
        vec2 p = vUv * 2.0 - 1.0;
        float edge = 1.0 - smoothstep(0.15, 1.0, length(p));
        float wisps = 0.86 + 0.14 * sin(p.x * 11.0 + sin(p.y * 8.0));
        float alpha = edge * edge * wisps * vOpacity;
        if (alpha < 0.003) discard;
        gl_FragColor = vec4(vec3(0.68, 0.70, 0.73), alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `,
  });
  private readonly mesh = new THREE.InstancedMesh(this.geometry, this.material, CAPACITY);
  private readonly puffs: Puff[] = Array.from({ length: CAPACITY }, () => ({
    position: new THREE.Vector3(), velocity: new THREE.Vector3(),
    age: 0, lifetime: 0, size: 0, opacity: 0,
  }));
  private readonly matrix = new THREE.Matrix4();
  private cursor = 0;

  constructor(scene: THREE.Scene) {
    this.geometry.setAttribute('smokeOpacity', this.opacity);
    this.opacity.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.name = 'TireSmoke';
    // Les particules sont en coordonnées monde, réparties sur tout le circuit.
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    scene.add(this.mesh);
  }

  update(dt: number): void {
    const drag = Math.exp(-2.2 * dt);
    for (const puff of this.puffs) {
      if (puff.age >= puff.lifetime) continue;
      puff.age += dt;
      puff.position.addScaledVector(puff.velocity, dt);
      puff.velocity.multiplyScalar(drag);
      puff.velocity.y += 0.65 * dt;
    }
  }

  emit(sources: TireSmokeSource[], dt: number): void {
    for (const source of sources) {
      if (source.intensity <= 0) continue;
      source.emissionRemainder += (12 + 32 * source.intensity) * dt;
      while (source.emissionRemainder >= 1) {
        source.emissionRemainder--;
        const puff = this.puffs[this.cursor];
        this.cursor = (this.cursor + 1) % CAPACITY;
        puff.age = 0;
        puff.lifetime = 0.85 + Math.random() * 0.6;
        puff.size = 0.3 + Math.random() * 0.25;
        puff.opacity = 0.18 + source.intensity * 0.24;
        puff.position.copy(source.position).addScaledVector(source.normal, 0.12);
        // Répartir l'émission le long du dernier pas pour une traînée continue.
        puff.position.addScaledVector(source.velocity, -Math.random() * dt);
        puff.position.x += (Math.random() - 0.5) * 0.15;
        puff.position.z += (Math.random() - 0.5) * 0.15;
        puff.velocity.copy(source.velocity).multiplyScalar(0.07)
          .addScaledVector(source.normal, 0.35 + Math.random() * 0.35);
        puff.velocity.x += (Math.random() - 0.5) * 0.6;
        puff.velocity.z += (Math.random() - 0.5) * 0.6;
      }
    }
  }

  render(): void {
    let count = 0;
    for (const puff of this.puffs) {
      if (puff.age >= puff.lifetime) continue;
      const life = puff.age / puff.lifetime;
      const size = puff.size + life * 1.8;
      this.matrix.makeScale(size, size, size).setPosition(puff.position);
      this.mesh.setMatrixAt(count, this.matrix);
      this.opacity.setX(count, puff.opacity * Math.min(1, life * 12) * (1 - life) ** 2);
      count++;
    }
    this.mesh.count = count;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.opacity.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.dispose();
    this.geometry.dispose();
    this.material.dispose();
  }
}
