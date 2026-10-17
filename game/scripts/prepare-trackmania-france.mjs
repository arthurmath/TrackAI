/** Prepare the downloaded Sketchfab GLB, preserving textures and separating its four wheels.
 * Usage: node scripts/prepare-trackmania-france.mjs /path/to/download.glb
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const input = process.argv[2];
if (!input) throw new Error('Pass the downloaded Trackmania France GLB as the first argument.');
const source = fs.readFileSync(input);
if (source.readUInt32LE(0) !== 0x46546c67 || source.readUInt32LE(4) !== 2) throw new Error('Expected GLB 2.0.');
const jsonLength = source.readUInt32LE(12);
const gltf = JSON.parse(source.subarray(20, 20 + jsonLength).toString());
const binaryStart = 28 + jsonLength;
const binary = source.subarray(binaryStart, binaryStart + source.readUInt32LE(20 + jsonLength));
const chunks = [binary];
let byteLength = binary.length;
const components = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
const bytes = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const read = { 5121: 'readUInt8', 5123: 'readUInt16LE', 5125: 'readUInt32LE', 5126: 'readFloatLE' };
function accessor(id) {
  const a = gltf.accessors[id];
  if (a.sparse) throw new Error('Sparse accessors are unsupported.');
  const view = gltf.bufferViews[a.bufferView];
  const itemSize = components[a.type] * bytes[a.componentType];
  return { ...a, itemSize, stride: view.byteStride ?? itemSize, start: (view.byteOffset ?? 0) + (a.byteOffset ?? 0) };
}
function append(data, target) {
  const padding = (4 - byteLength % 4) % 4;
  if (padding) { chunks.push(Buffer.alloc(padding)); byteLength += padding; }
  const id = gltf.bufferViews.length;
  gltf.bufferViews.push({ buffer: 0, byteOffset: byteLength, byteLength: data.length, target });
  chunks.push(data); byteLength += data.length;
  return id;
}
// All positions in this export share the same coordinate system. Some rims and
// hubs use the Details/Skin materials, so separating only Wheels leaves them behind.
const wheelNames = ['FL', 'FR', 'RL', 'RR'];
const tireNode = gltf.nodes.find(n => n.name === 'Wheels_01_Wheels_0');
if (!tireNode || tireNode.mesh === undefined) throw new Error('Expected the original merged wheel mesh.');
const tireMesh = tireNode.mesh;
const tirePrimitive = gltf.meshes[tireMesh].primitives[0];
function point(positions, index, axis) {
  return binary.readFloatLE(positions.start + index * positions.stride + axis * 4);
}
function triangleIndices(primitive) {
  const a = accessor(primitive.indices);
  return Array.from({ length: a.count }, (_, i) => binary[read[a.componentType]](a.start + i * a.stride));
}
const tirePositions = accessor(tirePrimitive.attributes.POSITION);
const tireVertices = new Map(wheelNames.map(name => [name, new Set()]));
for (const v of triangleIndices(tirePrimitive)) {
  const name = `${point(tirePositions, v, 2) > 0 ? 'F' : 'R'}${point(tirePositions, v, 0) < 0 ? 'L' : 'R'}`;
  tireVertices.get(name).add(v);
}
const centers = new Map();
for (const [name, vertices] of tireVertices) {
  const bounds = [0, 1, 2].map(axis => {
    const values = [...vertices].map(v => point(tirePositions, v, axis));
    return [Math.min(...values), Math.max(...values)];
  });
  centers.set(name, bounds.map(([min, max]) => (min + max) / 2));
}

// Weld UV/normal seams for connectivity only; output retains the original vertices.
// Moving whole connected components avoids cutting triangles or stretching the arms.
function componentsOf(primitive) {
  const positions = accessor(primitive.attributes.POSITION);
  const indices = triangleIndices(primitive);
  const parent = Array.from({ length: positions.count }, (_, i) => i);
  function root(i) {
    while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; }
    return i;
  }
  const join = (a, b) => { parent[root(a)] = root(b); };
  const welded = new Map();
  for (let i = 0; i < positions.count; i++) {
    const key = [0, 1, 2].map(axis => Math.round(point(positions, i, axis) * 1000)).join(',');
    if (welded.has(key)) join(i, welded.get(key));
    else welded.set(key, i);
  }
  for (let i = 0; i < indices.length; i += 3) {
    join(indices[i], indices[i + 1]); join(indices[i], indices[i + 2]);
  }
  const components = new Map();
  for (let i = 0; i < indices.length; i += 3) {
    const id = root(indices[i]);
    if (!components.has(id)) components.set(id, []);
    components.get(id).push(indices[i], indices[i + 1], indices[i + 2]);
  }
  return { positions, components: [...components.values()] };
}

function makePrimitive(primitive, triangles) {
  const vertices = [...new Set(triangles)];
  const remap = new Map(vertices.map((v, i) => [v, i]));
  const attributes = {};
  for (const [semantic, id] of Object.entries(primitive.attributes)) {
    const a = accessor(id);
    const data = Buffer.alloc(vertices.length * a.itemSize);
    vertices.forEach((v, i) => binary.copy(data, i * a.itemSize, a.start + v * a.stride, a.start + v * a.stride + a.itemSize));
    const output = { bufferView: append(data, 34962), componentType: a.componentType, count: vertices.length, type: a.type };
    if (a.normalized) output.normalized = true;
    if (semantic === 'POSITION') {
      output.min = [0, 1, 2].map(axis => Math.min(...vertices.map(v => point(a, v, axis))));
      output.max = [0, 1, 2].map(axis => Math.max(...vertices.map(v => point(a, v, axis))));
    }
    attributes[semantic] = gltf.accessors.length;
    gltf.accessors.push(output);
  }
  const wide = vertices.length > 65535;
  const data = Buffer.alloc(triangles.length * (wide ? 4 : 2));
  triangles.forEach((v, i) => data[wide ? 'writeUInt32LE' : 'writeUInt16LE'](remap.get(v), i * (wide ? 4 : 2)));
  const indexId = gltf.accessors.length;
  gltf.accessors.push({ bufferView: append(data, 34963), componentType: wide ? 5125 : 5123, count: triangles.length, type: 'SCALAR' });
  return { ...primitive, attributes, indices: indexId };
}
const assemblies = new Map(wheelNames.map(name => [name, []]));
const originalMeshes = [...gltf.meshes];
for (let meshId = 0; meshId < originalMeshes.length; meshId++) {
  const mesh = originalMeshes[meshId];
  const bodyPrimitives = [];
  for (const primitive of mesh.primitives) {
    const { positions, components } = componentsOf(primitive);
    const parts = new Map(wheelNames.map(name => [name, []]));
    const body = [];
    for (const component of components) {
      const vertices = [...new Set(component)];
      // Export units: tire radius ~36.4, outer width ~107.3. The inboard
      // cutoff includes hubs but excludes the suspension links running to the body.
      const name = wheelNames.find(name => {
        const center = centers.get(name);
        const side = name.endsWith('L') ? -1 : 1;
        return vertices.every(v => {
          const x = point(positions, v, 0) * side;
          const y = point(positions, v, 1) - center[1];
          const z = point(positions, v, 2) - center[2];
          return x >= 53 && x <= 108 && y * y + z * z <= 37.2 ** 2;
        });
      });
      const target = name ? parts.get(name) : body;
      for (const v of component) target.push(v);
    }
    if (body.length) bodyPrimitives.push(makePrimitive(primitive, body));
    for (const [name, triangles] of parts) {
      if (triangles.length) assemblies.get(name).push(makePrimitive(primitive, triangles));
    }
  }
  mesh.primitives = bodyPrimitives;
  if (!bodyPrimitives.length) {
    for (const node of gltf.nodes) if (node.mesh === meshId) delete node.mesh;
  }
}
// Wheel origins are at tire centers. The complete assemblies retain each material.
const car = gltf.nodes.find(node => node.name === 'TMCar');
if (!car) throw new Error('Expected TMCar root.');
for (const [name, primitives] of assemblies) {
  const materials = new Set(primitives.map(p => gltf.materials[p.material].name));
  if (!['Wheels', 'Details', 'Skin'].every(m => materials.has(m))) throw new Error(`Incomplete wheel ${name}.`);
  const center = centers.get(name);
  const meshId = gltf.meshes.length;
  gltf.meshes.push({ name: `Wheel_${name}`, primitives });
  const wheelId = gltf.nodes.length;
  gltf.nodes.push({ name: `Wheel_${name}`, translation: center, children: [wheelId + 1] });
  gltf.nodes.push({ name: `Wheel_${name}_Parts`, mesh: meshId, translation: center.map(v => -v) });
  car.children.push(wheelId);
  console.log(`Wheel_${name}: ${primitives.length} parts, materials ${[...materials].join(', ')}`);
}
// Drop emptied meshes, remapping node references to keep the GLB valid.
const meshRemap = new Map();
gltf.meshes = gltf.meshes.filter((mesh, i) => {
  if (!mesh.primitives.length) return false;
  meshRemap.set(i, meshRemap.size);
  return true;
});
for (const node of gltf.nodes) if (node.mesh !== undefined) node.mesh = meshRemap.get(node.mesh);
const binPadding = (4 - byteLength % 4) % 4;
chunks.push(Buffer.alloc(binPadding)); byteLength += binPadding;
gltf.buffers[0].byteLength = byteLength;
const json = Buffer.from(JSON.stringify(gltf));
const jsonPadding = (4 - json.length % 4) % 4;
const jsonChunk = Buffer.concat([json, Buffer.alloc(jsonPadding, 0x20)]);
const header = Buffer.alloc(20);
header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4);
header.writeUInt32LE(28 + jsonChunk.length + byteLength, 8);
header.writeUInt32LE(jsonChunk.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
const binHeader = Buffer.alloc(8); binHeader.writeUInt32LE(byteLength, 0); binHeader.writeUInt32LE(0x004e4942, 4);
const output = fileURLToPath(new URL('../public/models/cars/trackmania-france/trackmania-france.glb', import.meta.url));
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, Buffer.concat([header, jsonChunk, binHeader, ...chunks]));
console.log(`Prepared ${output}`);
