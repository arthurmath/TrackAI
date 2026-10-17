import * as THREE from 'three';

/**
 * Keep the imported venue's colour grading local to Stadium Sprint. The GLB
 * uses shiny metallic defaults even for its textured plastic seats, which
 * makes the floodlights wash their blue out into white highlights.
 */
export function tuneStadiumMaterials(model: THREE.Object3D): void {
  const materials = new Map<THREE.Material, THREE.Material>();

  const tune = (source: THREE.Material): THREE.Material => {
    const existing = materials.get(source);
    if (existing) return existing;

    // Object3D.clone() shares materials with AssetLoader's cached GLB.
    const material = source.clone();
    materials.set(source, material);
    if (!(material instanceof THREE.MeshStandardMaterial)) return material;

    switch (source.name) {
      case 'Material.008':
        // The texture supplies the saturated blue; neutral plastic keeps its
        // hue intact under the stadium's white floodlights.
        material.color.set(0xffffff);
        material.metalness = 0;
        material.roughness = 0.82;
        break;
      case 'kich-thuoc-san-bong-da.003':
        // Reduce the yellow cast of the turf without losing its mowing bands
        // or white football markings.
        material.color.set(0xe1f0e1);
        material.metalness = 0;
        material.roughness = 0.96;
        break;
      case 'Material.009':
      case 'Material.044':
      case 'Material.053':
        // Blue trim and shelter panels use the same coherent stadium palette.
        material.color.multiplyScalar(0.88);
        material.metalness = Math.min(material.metalness, 0.12);
        material.roughness = Math.max(material.roughness, 0.58);
        break;
      case 'Material.043':
      case 'Material.050':
      case 'Material.052':
      case 'Material.056':
      case 'CC-07.008':
        // Softer neutral architecture leaves room for the blue stands and
        // green infield instead of surrounding them with brilliant white.
        material.color.multiplyScalar(0.8);
        material.roughness = Math.max(material.roughness, 0.68);
        break;
      case 'Material.015':
      case 'Material.059':
        material.emissiveIntensity = 0.55;
        break;
    }

    return material;
  };

  model.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.material = Array.isArray(object.material)
      ? object.material.map(tune)
      : tune(object.material);
  });
}
