// Generates public/fallback/podium.glb: a generic three-step podium used when a
// sport has no dedicated 3D model or its GLB fails to load. Meters, Y-up,
// bottom-center origin, no textures. Run: node scripts/make-fallback-glb.mjs
import { writeFileSync, mkdirSync } from 'node:fs'

const W = 0.1, D = 0.1
// [centerX, height, materialIndex] — 2nd, 1st, 3rd
const steps = [[-W, 0.07, 0], [0, 0.11, 1], [W, 0.045, 0]]

const materials = [
  { name: 'step', pbrMetallicRoughness: { baseColorFactor: [0.2, 0.25, 0.33, 1], metallicFactor: 0, roughnessFactor: 0.7 } },
  { name: 'winner', pbrMetallicRoughness: { baseColorFactor: [0.2, 0.83, 0.6, 1], metallicFactor: 0, roughnessFactor: 0.45 } },
]

function box(cx, h) {
  const x0 = cx - W / 2, x1 = cx + W / 2, z0 = -D / 2, z1 = D / 2
  const faces = [
    [[0, 1, 0], [[x0, h, z1], [x1, h, z1], [x1, h, z0], [x0, h, z0]]],
    [[0, -1, 0], [[x0, 0, z0], [x1, 0, z0], [x1, 0, z1], [x0, 0, z1]]],
    [[0, 0, 1], [[x0, 0, z1], [x1, 0, z1], [x1, h, z1], [x0, h, z1]]],
    [[0, 0, -1], [[x1, 0, z0], [x0, 0, z0], [x0, h, z0], [x1, h, z0]]],
    [[1, 0, 0], [[x1, 0, z1], [x1, 0, z0], [x1, h, z0], [x1, h, z1]]],
    [[-1, 0, 0], [[x0, 0, z0], [x0, 0, z1], [x0, h, z1], [x0, h, z0]]],
  ]
  const pos = [], nrm = [], idx = []
  faces.forEach(([n, quad], f) => {
    quad.forEach((p) => { pos.push(...p); nrm.push(...n) })
    const b = f * 4
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3)
  })
  return { pos, nrm, idx }
}

const buffers = []
const bufferViews = []
const accessors = []
let offset = 0
function addView(typed, target) {
  const bytes = Buffer.from(typed.buffer)
  bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, target })
  buffers.push(bytes)
  offset += bytes.length
  const pad = (4 - (offset % 4)) % 4
  if (pad) { buffers.push(Buffer.alloc(pad)); offset += pad }
  return bufferViews.length - 1
}

const primitives = steps.map(([cx, h, material]) => {
  const { pos, nrm, idx } = box(cx, h)
  const min = [cx - W / 2, 0, -D / 2], max = [cx + W / 2, h, D / 2]
  accessors.push({ bufferView: addView(new Float32Array(pos), 34962), componentType: 5126, count: pos.length / 3, type: 'VEC3', min, max })
  const position = accessors.length - 1
  accessors.push({ bufferView: addView(new Float32Array(nrm), 34962), componentType: 5126, count: nrm.length / 3, type: 'VEC3' })
  const normal = accessors.length - 1
  accessors.push({ bufferView: addView(new Uint16Array(idx), 34963), componentType: 5123, count: idx.length, type: 'SCALAR' })
  return { attributes: { POSITION: position, NORMAL: normal }, indices: accessors.length - 1, material }
})

const bin = Buffer.concat(buffers)
const gltf = {
  asset: { version: '2.0', generator: 'SportSnap scripts/make-fallback-glb.mjs' },
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes: [{ mesh: 0, name: 'podium', extras: { author: 'SportSnap team', role: 'fallback' } }],
  meshes: [{ name: 'podium', primitives }],
  materials,
  accessors,
  bufferViews,
  buffers: [{ byteLength: bin.length }],
}

let json = Buffer.from(JSON.stringify(gltf), 'utf8')
json = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)])
const total = 12 + 8 + json.length + 8 + bin.length
const header = Buffer.alloc(12)
header.write('glTF', 0, 'ascii'); header.writeUInt32LE(2, 4); header.writeUInt32LE(total, 8)
const jsonHead = Buffer.alloc(8); jsonHead.writeUInt32LE(json.length, 0); jsonHead.write('JSON', 4, 'ascii')
const binHead = Buffer.alloc(8); binHead.writeUInt32LE(bin.length, 0); binHead.write('BIN\0', 4, 'ascii')

const out = new URL('../public/fallback/podium.glb', import.meta.url)
mkdirSync(new URL('.', out), { recursive: true })
writeFileSync(out, Buffer.concat([header, jsonHead, json, binHead, bin]))
console.log(`wrote ${out.pathname} (${total} bytes)`)
