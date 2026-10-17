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
const node = gltf.nodes.find(n => n.name === 'Wheels_01_Wheels_0');
if (!node || node.mesh === undefined) throw new Error('Expected the original merged wheel mesh.');
const primitive = gltf.meshes[node.mesh].primitives[0];
const positions = accessor(primitive.attributes.POSITION);
const indices = accessor(primitive.indices);
const position = (index, axis) => binary.readFloatLE(positions.start + index * positions.stride + axis * 4);
const groups = new Map(['FL', 'FR', 'RL', 'RR'].map(name => [name, []]));
for (let i = 0; i < indices.count; i += 3) {
  const triangle = [0, 1, 2].map(k => binary[read[indices.componentType]](indices.start + (i + k) * indices.stride));
  const sides = triangle.map(v => `${position(v, 2) > 0 ? 'F' : 'R'}${position(v, 0) < 0 ? 'L' : 'R'}`);
  if (!sides.every(side => side === sides[0])) throw new Error('A wheel triangle crosses the separation plane.');
  groups.get(sides[0]).push(...triangle);
}
node.children = [];
delete node.mesh;
for (const [name, triangles] of groups) {
  if (!triangles.length) throw new Error(`Missing wheel ${name}.`);
  const vertices = [...new Set(triangles)];
  const remap = new Map(vertices.map((v, i) => [v, i]));
  const attributes = {};
  let bounds;
  for (const [semantic, id] of Object.entries(primitive.attributes)) {
    const a = accessor(id);
    const data = Buffer.alloc(vertices.length * a.itemSize);
    vertices.forEach((v, i) => binary.copy(data, i * a.itemSize, a.start + v * a.stride, a.start + v * a.stride + a.itemSize));
    const newAccessor = { bufferView: append(data, 34962), componentType: a.componentType, count: vertices.length, type: a.type };
    if (a.normalized) newAccessor.normalized = true;
    if (semantic === 'POSITION') {
      newAccessor.min = [0, 1, 2].map(axis => Math.min(...vertices.map(v => position(v, axis))));
      newAccessor.max = [0, 1, 2].map(axis => Math.max(...vertices.map(v => position(v, axis))));
      bounds = { min: newAccessor.min, max: newAccessor.max };
    }
    attributes[semantic] = gltf.accessors.length;
    gltf.accessors.push(newAccessor);
  }
  const data = Buffer.alloc(triangles.length * 2);
  if (vertices.length > 65535) throw new Error('Wheel needs 32-bit indices.');
  triangles.forEach((v, i) => data.writeUInt16LE(remap.get(v), i * 2));
  const indexId = gltf.accessors.length;
  gltf.accessors.push({ bufferView: append(data, 34963), componentType: 5123, count: triangles.length, type: 'SCALAR' });
  const meshId = gltf.meshes.length;
  gltf.meshes.push({ name: `Wheel_${name}`, primitives: [{ ...primitive, attributes, indices: indexId }] });
  node.children.push(gltf.nodes.length);
  gltf.nodes.push({ name: `Wheel_${name}`, mesh: meshId });
  console.log(name, JSON.stringify(bounds));
}
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
