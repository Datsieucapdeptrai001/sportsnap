import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { explainImage, getInsights } from '../src/lib/api.ts'
import { loadExplanation, selectBestFrame } from '../src/lib/explain.ts'
import { confusionStrength, metric } from '../src/lib/insights.ts'

const data = JSON.parse(readFileSync(new URL('../../backend/data/experiments.json', import.meta.url), 'utf8'))

test('explain uploads exactly one original image on demand and passes cancellation', async (t) => {
  const image = new File(['original'], 'photo.png', { type: 'image/png' })
  const controller = new AbortController()
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, '/api/explain')
    assert.equal(options.method, 'POST')
    assert.equal(options.signal, controller.signal)
    assert.deepEqual([...options.body.keys()], ['file'])
    assert.equal(await options.body.get('file').text(), 'original')
    assert.equal(options.body.get('file').name, 'photo.png')
    return Response.json({ label: 'baseball', overlay_png_base64: 'PNG' })
  })
  assert.equal((await explainImage(image, controller.signal)).label, 'baseball')
})

test('explanation dialog publishes loading, error, and successful retry', async () => {
  const states = []
  const image = new Blob(['image'])
  const signal = new AbortController().signal
  await loadExplanation(image, signal, (state) => states.push(state), async () => { throw new Error('Lỗi mạng') })
  assert.deepEqual(states.map((state) => state.status), ['loading', 'error'])
  assert.equal(states[1].message, 'Lỗi mạng')
  const result = { label: 'golf', confidence: 0.5, is_uncertain: true }
  await loadExplanation(image, signal, (state) => states.push(state), async () => result)
  assert.deepEqual(states.map((state) => state.status), ['loading', 'error', 'loading', 'success'])
  assert.equal(states[3].result, result)
})

test('closing/changing an explanation discards stale success and errors', async () => {
  for (const fails of [false, true]) {
    const controller = new AbortController()
    const states = []
    let finish
    const task = loadExplanation(new Blob(), controller.signal, (state) => states.push(state), () => new Promise((resolve, reject) => {
      finish = () => fails ? reject(new Error('late')) : resolve({ label: 'late' })
    }))
    controller.abort()
    finish()
    await task
    assert.deepEqual(states, [{ status: 'loading' }])
  }
})

test('camera retains the strongest uploaded frame matching the averaged label', () => {
  const frames = [new Blob(['0']), new Blob(['1']), new Blob(['2'])]
  const result = { label: 'golf', per_frame: [{ label: 'polo', confidence: 0.99 }, { label: 'golf', confidence: 0.7 }, { label: 'golf', confidence: 0.8 }] }
  assert.equal(selectBestFrame(frames, result), frames[2])
  assert.equal(selectBestFrame(frames, { ...result, label: 'baseball' }), frames[0])
  assert.equal(selectBestFrame([], { label: 'golf', per_frame: [] }), null)
})

test('unsupported Grad-CAM and network failures are safe Vietnamese messages', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json({ error: { code: 'gradcam_unsupported', message: 'secret stack' } }, { status: 501 }))
  await assert.rejects(explainImage(new Blob()), /chưa hỗ trợ bản đồ/)
  fetch.mock.mockImplementation(async () => { throw new TypeError('Failed to fetch') })
  await assert.rejects(explainImage(new Blob()), /kiểm tra mạng/)
  await assert.rejects(getInsights(), /Kiểm tra kết nối/)
})

test('Insights reads the API data and passes its abort signal', async (t) => {
  const signal = new AbortController().signal
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, '/api/insights')
    assert.equal(options.signal, signal)
    return Response.json(data)
  })
  assert.deepEqual(await getInsights(signal), data)
})

test('analysis renders null as a dash and preserves measured zero', () => {
  assert.equal(metric(null), '—')
  assert.equal(metric(null, true), '—')
  assert.equal(metric(0), '0')
  assert.match(metric(0.99, true), /99/)
  assert.deepEqual(data.models.map((model) => model.name).sort(), ['CNN_Scratch', 'MobileNetV2', 'ResNet50'])
  for (const model of data.models) {
    assert.equal(metric(model.latency_ms), '—')
    assert.equal(metric(model.size_mb), '—')
    assert.equal(metric(model.params_m), '—')
    if (model.name !== data.selected_model) assert.equal(metric(model.macro_f1), '—')
  }
})

test('heatmap counts and color intensity reflect the selected split only', () => {
  for (const split of data.splits) {
    assert.equal(split.confusion_matrix.length, split.labels.length)
    assert.equal(split.confusion_matrix.flat().reduce((a, b) => a + b, 0), split.count)
    const maximum = Math.max(...split.confusion_matrix.flat())
    assert.equal(confusionStrength(split, maximum), 1)
    assert.equal(confusionStrength(split, 0), 0)
    assert.equal(split.confusion_matrix.reduce((sum, row, i) => sum + row[i], 0) / split.count, split.accuracy)
  }
})
