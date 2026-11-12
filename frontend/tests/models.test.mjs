import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const modelsDir = new URL('../public/models/', import.meta.url)
const manifest = JSON.parse(readFileSync(new URL('manifest.json', modelsDir), 'utf8'))
const assetsDoc = readFileSync(new URL('../../docs/ASSETS.md', import.meta.url), 'utf8')

test('the inventory contains all 24 builders and covers all unchanged training labels when available', () => {
  assert.equal(Object.keys(manifest.models).length, 24)
  assert.equal(manifest.units, 'meters')
  assert.equal(manifest.up_axis, 'Y')
  assert.equal(manifest.origin, 'bottom-center')
  const labelsFile = new URL('../../backend/models/labels.json', import.meta.url)
  if (existsSync(labelsFile)) {
    const labels = JSON.parse(readFileSync(labelsFile, 'utf8').replace(/^\uFEFF/, ''))
    for (const label of labels) assert.ok(Object.hasOwn(manifest.models, label), label)
  }
  for (const extra of ['archery', 'boxing', 'tennis', 'volleyball']) {
    assert.ok(Object.hasOwn(manifest.models, extra), extra)
  }
  const mapping = readFileSync(new URL('../src/lib/sports3d.ts', import.meta.url), 'utf8')
  assert.match(mapping, /import manifest from '\.\.\/\.\.\/public\/models\/manifest\.json'/)
  assert.match(mapping, /Object\.entries\(manifest\.models\)/)
})

for (const [label, entry] of Object.entries(manifest.models)) {
  test(`${label}: original documented GLB, correct budgets, meter scale and grounded Y-up geometry`, () => {
    assert.equal(entry.file, `${label.toLowerCase().replaceAll(' ', '_')}.glb`)
    const path = new URL(entry.file, modelsDir)
    assert.ok(existsSync(path), fileURLToPath(path))
    assert.ok(assetsDoc.split('\n').some((row) => row.startsWith(`| ${label} |`) && row.includes(entry.file)
      && row.includes('tự tạo bằng Blender script (tools/blender/make_sport_models.py)')
      && row.includes('tác giả nhóm SportSnap') && row.includes('không dùng asset bên thứ ba')))
    const bytes = readFileSync(path)
    assert.equal(bytes.length, entry.bytes)
    assert.ok(bytes.length <= 2_000_000)
    assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256)
    assert.equal(bytes.toString('ascii', 0, 4), 'glTF')
    assert.equal(bytes.readUInt32LE(4), 2)
    assert.equal(bytes.readUInt32LE(8), bytes.length)
    const jsonLength = bytes.readUInt32LE(12)
    const gltf = JSON.parse(bytes.toString('utf8', 20, 20+jsonLength))
    const binaryStart = 20+jsonLength+8
    assert.equal(bytes.toString('ascii', 24+jsonLength, 28+jsonLength), 'BIN\0')
    assert.equal(gltf.images, undefined, 'no external or embedded image textures')
    assert.equal(gltf.cameras, undefined, 'studio camera must not be exported')
    assert.equal(gltf.buffers.length, 1)
    assert.equal(gltf.buffers[0].uri, undefined, 'self-contained binary')
    assert.equal(gltf.nodes.length, 1, 'one joined representative object, no studio floor or lights')
    const node = gltf.nodes[0]
    for (const transform of ['rotation', 'translation', 'scale', 'matrix']) {
      assert.equal(node[transform], undefined, 'positions already use the final meter/Y-up frame')
    }
    assert.equal(node.extras.sport, label)
    assert.equal(node.extras.author, 'SportSnap team')
    const lo = [Infinity, Infinity, Infinity]
    const hi = [-Infinity, -Infinity, -Infinity]
    let triangles = 0
    for (const primitive of gltf.meshes[node.mesh].primitives) {
      assert.equal(primitive.mode ?? 4, 4)
      triangles += gltf.accessors[primitive.indices].count/3
      const accessor = gltf.accessors[primitive.attributes.POSITION]
      assert.equal(accessor.componentType, 5126)
      const view = gltf.bufferViews[accessor.bufferView]
      const offset = binaryStart+(view.byteOffset ?? 0)+(accessor.byteOffset ?? 0)
      for (let vertex = 0; vertex < accessor.count; vertex++) {
        for (let axis = 0; axis < 3; axis++) {
          const value = bytes.readFloatLE(offset+vertex*(view.byteStride ?? 12)+axis*4)
          assert.ok(Number.isFinite(value))
          lo[axis] = Math.min(lo[axis], value)
          hi[axis] = Math.max(hi[axis], value)
        }
      }
    }
    assert.equal(triangles, entry.triangles)
    assert.ok(triangles > 0 && triangles <= 30_000)
    assert.ok(Math.abs(lo[1]) < 1e-5, `Y bottom: ${lo[1]}`)
    assert.ok(Math.abs(lo[0]+hi[0]) < 1e-5, 'centered X')
    assert.ok(Math.abs(lo[2]+hi[2]) < 1e-5, 'centered Z')
    for (let axis = 0; axis < 3; axis++) {
      assert.ok(Math.abs(hi[axis]-lo[axis]-entry.dimensions_m[axis]) < 1e-5)
    }
    for (const mat of gltf.materials) {
      const pbr = mat.pbrMetallicRoughness
      assert.ok(pbr)
      assert.ok((pbr.roughnessFactor ?? 1) >= 0 && (pbr.roughnessFactor ?? 1) <= 1)
      assert.ok((pbr.metallicFactor ?? 1) >= 0 && (pbr.metallicFactor ?? 1) <= 1)
    }
  })
}
