import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'
import { createViewerLoader, getArAvailability, modelLoadProgress, modelSource } from '../src/lib/ar.ts'

const manifest = JSON.parse(readFileSync(new URL('../public/models/manifest.json', import.meta.url), 'utf8'))
const assets = Object.fromEntries(Object.entries(manifest.models).map(([label, model]) => [label, { glb: `/models/${model.file}` }]))

for (const [label, model] of Object.entries(manifest.models)) {
  test(`${label}: a certain result enables AR at the exact manifest GLB path`, () => {
    const state = getArAvailability(label, false, assets)
    assert.equal(state.enabled, true)
    assert.equal(state.asset.glb, `/models/${model.file}`)
    assert.ok(existsSync(new URL(`../public${state.asset.glb}`, import.meta.url)))
    assert.equal(state.message, '')
  })
  test(`${label}: an uncertain result disables AR with a Vietnamese explanation`, () => {
    const state = getArAvailability(label, true, assets)
    assert.equal(state.enabled, false)
    assert.equal(state.message, 'Kết quả chưa chắc chắn nên chưa mở AR')
    assert.equal(state.asset, undefined)
  })
}

for (const label of ['unknown sport', '', 'constructor', 'toString', '__proto__']) {
  test(`${label || '(empty label)'}: an absent manifest label disables AR`, () => {
    const state = getArAvailability(label, false, assets)
    assert.equal(state.enabled, false)
    assert.match(state.message, /chưa có mô hình 3D/)
  })
}

test('missing and uncertain results explain both restrictions', () => {
  const state = getArAvailability('unknown sport', true, assets)
  assert.equal(state.enabled, false)
  assert.match(state.message, /Kết quả chưa chắc chắn nên chưa mở AR/)
  assert.match(state.message, /chưa có mô hình 3D/)
})

test('only local manifest model paths can enable AR', () => {
  for (const glb of ['/models/../secrets.glb', 'https://example.com/model.glb', '/models/missing.usdz']) {
    assert.equal(getArAvailability('sport', false, { sport: { glb } }).enabled, false)
  }
  assert.equal(getArAvailability('sport', false, Object.create({ sport: { glb: '/models/sport.glb' } })).enabled, false)
})

test('viewer library is lazy and shares one in-flight and successful import', async () => {
  let imports = 0
  let finish
  const loader = createViewerLoader(() => {
    imports++
    return new Promise((resolve) => { finish = resolve })
  })
  assert.equal(imports, 0)
  const first = loader()
  const second = loader()
  assert.equal(first, second)
  await Promise.resolve()
  assert.equal(imports, 1)
  finish()
  await first
  await loader()
  assert.equal(imports, 1)
})

test('a network/import error can be retried instead of poisoning later dialogs', async () => {
  let imports = 0
  const loader = createViewerLoader(async () => {
    if (++imports === 1) throw new Error('simulated network failure')
  })
  await assert.rejects(loader(), /network failure/)
  await loader()
  assert.equal(imports, 2)
})

test('a synchronous importer failure also permits retry', async () => {
  let imports = 0
  const loader = createViewerLoader(() => {
    if (++imports === 1) throw new Error('simulated import failure')
    return Promise.resolve()
  })
  await assert.rejects(loader(), /import failure/)
  await loader()
  assert.equal(imports, 2)
})

test('progress uses the real event fraction and clamps malformed/out-of-range values', () => {
  for (const [value, expected] of [[0, 0], [.427, 43], [1, 100], [-1, 0], [2, 100], [NaN, 0], [Infinity, 0], [undefined, 0], ['.5', 0]]) {
    assert.equal(modelLoadProgress(value), expected)
  }
})

test('GLB retries bypass cached failures while keeping the exact manifest file path', () => {
  const glb = assets[Object.keys(assets)[0]].glb
  assert.equal(modelSource(glb, 0), glb)
  const first = new URL(modelSource(glb, 1), 'https://sportsnap.example')
  const second = new URL(modelSource(glb, 2), 'https://sportsnap.example')
  assert.equal(first.pathname, glb)
  assert.equal(second.pathname, glb)
  assert.notEqual(first.href, second.href)
})
