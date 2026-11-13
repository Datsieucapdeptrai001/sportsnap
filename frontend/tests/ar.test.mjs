import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'
import { createViewerLoader, getArAvailability, getCameraOverlayAsset, modelLoadProgress, modelSource, readAutoOpenArPreference, saveAutoOpenArPreference } from '../src/lib/ar.ts'
import { splitSportLabel, sportNamesVi, sportNameVi } from '../src/lib/sport-names.ts'

const manifest = JSON.parse(readFileSync(new URL('../public/models/manifest.json', import.meta.url), 'utf8'))
const assets = Object.fromEntries(Object.entries(manifest.models).map(([label, model]) => [label, { glb: `/models/${model.file}` }]))

test('Vietnamese display names cover all 24 manifest and training labels', () => {
  const labels = JSON.parse(readFileSync(new URL('../../backend/models/labels.json', import.meta.url), 'utf8'))
  assert.equal(labels.length, 20)
  for (const label of labels) assert.ok(Object.hasOwn(sportNamesVi, label), label)
  assert.deepEqual(Object.keys(sportNamesVi).sort(), Object.keys(manifest.models).sort())
  for (const label of Object.keys(manifest.models)) {
    assert.ok(sportNameVi(label).length > 0)
    assert.notEqual(sportNameVi(label), label)
  }
  assert.equal(sportNameVi('archery'), 'Bắn cung')
  assert.equal(sportNameVi('boxing'), 'Quyền anh')
  assert.equal(sportNameVi('tennis'), 'Quần vợt')
  assert.equal(sportNameVi('volleyball'), 'Bóng chuyền')
  assert.equal(sportNameVi('baseball'), 'Bóng chày')
  assert.equal(sportNameVi('basketball'), 'Bóng rổ')
  assert.equal(sportNameVi('football'), 'Bóng bầu dục Mỹ')
  assert.equal(sportNameVi('rugby'), 'Bóng bầu dục')
  assert.deepEqual(splitSportLabel('football'), { display: 'Bóng bầu dục Mỹ', raw: 'football' })
  assert.deepEqual(splitSportLabel('unknown sport'), { display: 'unknown sport', raw: null })
  assert.equal(sportNameVi('unknown sport'), 'unknown sport')
  assert.equal(sportNameVi('constructor'), 'constructor')
})

test('camera overlay shows the top-1 model for any result while the switch is on', () => {
  for (const label of Object.keys(assets)) {
    assert.equal(getCameraOverlayAsset({ label, is_uncertain: false }, true, assets), assets[label])
    assert.equal(getCameraOverlayAsset({ label, is_uncertain: true }, true, assets), assets[label])
    assert.equal(getCameraOverlayAsset({ label, is_uncertain: false }, false, assets), null)
  }
  assert.deepEqual(getCameraOverlayAsset({ label: 'unknown sport', is_uncertain: false }, true, assets), { glb: '/models/unknown_sport.glb' })
  assert.equal(getCameraOverlayAsset(null, true, assets), null)
})

test('rescan clears the result; toggling cannot restore it until a new scan', () => {
  let result = { label: 'baseball', is_uncertain: false }
  assert.ok(getCameraOverlayAsset(result, true, assets))
  assert.equal(getCameraOverlayAsset(result, false, assets), null)
  assert.ok(getCameraOverlayAsset(result, true, assets))
  result = null // The scanner's reset callback clears the parent result without unmounting video.
  assert.equal(getCameraOverlayAsset(result, false, assets), null)
  assert.equal(getCameraOverlayAsset(result, true, assets), null)
  result = { label: 'baseball', is_uncertain: true }
  assert.ok(getCameraOverlayAsset(result, true, assets))
})

test('auto-open preference defaults on, persists both choices and tolerates blocked storage', () => {
  const entries = new Map()
  const storage = { getItem: (key) => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value) }
  assert.equal(readAutoOpenArPreference(storage), true)
  saveAutoOpenArPreference(false, storage)
  assert.equal(readAutoOpenArPreference(storage), false)
  saveAutoOpenArPreference(true, storage)
  assert.equal(readAutoOpenArPreference(storage), true)
  const blocked = { getItem() { throw new Error('blocked') }, setItem() { throw new Error('blocked') } }
  assert.equal(readAutoOpenArPreference(blocked), true)
  assert.doesNotThrow(() => saveAutoOpenArPreference(false, blocked))
})

for (const [label, model] of Object.entries(manifest.models)) {
  test(`${label}: a result enables AR at the exact manifest GLB path`, () => {
    const state = getArAvailability(label, false, assets)
    assert.equal(state.enabled, true)
    assert.equal(state.asset.glb, `/models/${model.file}`)
    assert.ok(existsSync(new URL(`../public${state.asset.glb}`, import.meta.url)))
    assert.equal(state.message, '')
  })
  test(`${label}: an uncertain result still enables AR with the same model`, () => {
    const state = getArAvailability(label, true, assets)
    assert.equal(state.enabled, true)
    assert.equal(state.asset.glb, `/models/${model.file}`)
  })
}

test('a label without a mapped model uses /models/<label>.glb (trophy fallback at load time)', () => {
  assert.equal(getArAvailability('unknown sport', true, assets).asset.glb, '/models/unknown_sport.glb')
  assert.equal(getArAvailability('Canoe  Slamon', false, {}).asset.glb, '/models/canoe_slamon.glb')
  for (const label of ['', 'constructor', 'toString', '__proto__', '../secrets']) {
    const state = getArAvailability(label, false, assets)
    assert.equal(state.enabled, true)
    assert.match(state.asset.glb, /^\/models\/[a-z0-9_]+\.glb$/)
  }
  assert.equal(getArAvailability('', false, assets).asset.glb, '/models/trophy.glb')
  assert.equal(getArAvailability('../secrets', false, assets).asset.glb, '/models/trophy.glb')
})

test('unsafe mapped paths are ignored in favour of the local convention path', () => {
  for (const glb of ['/models/../secrets.glb', 'https://example.com/model.glb', '/models/missing.usdz']) {
    assert.equal(getArAvailability('sport', false, { sport: { glb } }).asset.glb, '/models/sport.glb')
  }
  assert.equal(getArAvailability('sport', false, Object.create({ sport: { glb: 'https://x/y.glb' } })).asset.glb, '/models/sport.glb')
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
