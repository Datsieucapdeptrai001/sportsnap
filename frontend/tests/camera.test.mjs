import assert from 'node:assert/strict'
import test from 'node:test'
import { cameraErrorMessage, captureFrames, checkCameraSupport, compressFrames } from '../src/lib/camera.ts'

function replaceGlobal(t, name, value) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, name)
  Object.defineProperty(globalThis, name, { configurable: true, value })
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, name, previous)
    else delete globalThis[name]
  })
}

function setupCanvas(t, size = () => 100_000) {
  const encodes = []
  const draws = []
  const createCanvas = (width = 640, height = 360) => ({
    width, height,
    getContext: () => ({ drawImage: (...args) => draws.push(args) }),
    toBlob(callback, type, quality) {
      encodes.push({ width: this.width, height: this.height, quality })
      callback(new Blob([new Uint8Array(size(this.width, quality))], { type }))
    },
  })
  replaceGlobal(t, 'document', { createElement: () => createCanvas() })
  return { frames: Array.from({ length: 4 }, () => createCanvas()), encodes, draws }
}

for (const [name, pattern] of [
  ['NotAllowedError', /từ chối/], ['SecurityError', /từ chối/],
  ['NotFoundError', /Không tìm thấy/], ['OverconstrainedError', /Không tìm thấy/],
  ['NotReadableError', /ứng dụng khác/], ['AbortError', /thử lại/], ['UnknownError', /thư viện/],
]) {
  test(`camera ${name} has a Vietnamese recovery message`, () => {
    assert.match(cameraErrorMessage(new DOMException('private error', name)), pattern)
    assert.doesNotMatch(cameraErrorMessage(new DOMException('private error', name)), /private error/)
  })
}

test('insecure context is detected before missing media APIs', (t) => {
  replaceGlobal(t, 'window', { isSecureContext: false })
  replaceGlobal(t, 'navigator', {})
  assert.throws(checkCameraSupport, /HTTPS hoặc localhost/)
})

test('unsupported camera API has a gallery fallback', (t) => {
  replaceGlobal(t, 'window', { isSecureContext: true })
  replaceGlobal(t, 'navigator', {})
  assert.throws(checkCameraSupport, /không hỗ trợ camera/)
})

test('supported secure browser passes the camera check', (t) => {
  replaceGlobal(t, 'window', { isSecureContext: true })
  replaceGlobal(t, 'navigator', { mediaDevices: { getUserMedia() {} } })
  assert.doesNotThrow(checkCameraSupport)
})

test('ordinary scans retain four JPEGs at quality 0.85 with multipart payload below 1.5 MB', async (t) => {
  const env = setupCanvas(t)
  const blobs = await compressFrames(env.frames, new AbortController().signal)
  assert.equal(blobs.length, 4)
  assert.ok(blobs.every((blob) => blob.type === 'image/jpeg'))
  assert.deepEqual(env.encodes.map((item) => item.quality), [0.85, 0.85, 0.85, 0.85])
  const body = new FormData()
  blobs.forEach((blob, index) => body.append('files', blob, `frame-${index + 1}.jpg`))
  assert.ok((await new Response(body).blob()).size < 1_500_000)
})

for (const quality of [0.75, 0.65, 0.55]) {
  test(`compression stops at quality ${quality} before resizing or dropping frames`, async (t) => {
    const env = setupCanvas(t, (_width, current) => current > quality ? 400_000 : 300_000)
    const blobs = await compressFrames(env.frames, new AbortController().signal)
    assert.equal(blobs.length, 4)
    const qualities = [0.85, 0.75, 0.65, 0.55]
    assert.deepEqual(env.encodes.map((item) => item.quality), qualities.slice(0, qualities.indexOf(quality) + 1).flatMap((value) => Array(4).fill(value)))
    assert.equal(env.draws.length, 0)
  })
}

for (const [frameSize, count] of [[300_000, 4], [490_000, 3], [700_000, 2]]) {
  test(`after all quality steps, 512px compression retains ${count} frames within the payload limit`, async (t) => {
    const env = setupCanvas(t, (width) => width > 512 ? 500_000 : frameSize)
    const blobs = await compressFrames(env.frames, new AbortController().signal)
    assert.equal(blobs.length, count)
    assert.deepEqual(env.encodes.map((item) => item.quality), [0.85, 0.75, 0.65, 0.55, 0.55].flatMap((value) => Array(4).fill(value)))
    assert.deepEqual(env.encodes.slice(-4), Array(4).fill({ width: 512, height: 288, quality: 0.55 }))
    const body = new FormData()
    blobs.forEach((blob, index) => body.append('files', blob, `frame-${index + 1}.jpg`))
    assert.ok((await new Response(body).blob()).size < 1_500_000)
  })
}

test('oversized scans fail without sending fewer than two frames', async (t) => {
  const env = setupCanvas(t, () => 800_000)
  await assert.rejects(compressFrames(env.frames, new AbortController().signal), /1,5 MB/)
})

test('capture takes four frames about 300ms apart and preserves portrait aspect ratio within 640px', async (t) => {
  const env = setupCanvas(t)
  const times = []
  const video = { readyState: 2, videoWidth: 1080, videoHeight: 1920 }
  const blobs = await captureFrames(video, new AbortController().signal, (count) => times.push({ count, time: performance.now() }))
  assert.equal(blobs.length, 4)
  assert.deepEqual(times.map((item) => item.count), [1, 2, 3, 4])
  for (let index = 1; index < times.length; index++) assert.ok(times[index].time - times[index - 1].time >= 280)
  assert.deepEqual(env.encodes, Array(4).fill({ width: 360, height: 640, quality: 0.85 }))
  assert.ok(env.draws.every((args) => args[0] === video))
})

test('unready video is rejected before drawing or uploading', async (t) => {
  const env = setupCanvas(t)
  await assert.rejects(captureFrames({ readyState: 0, videoWidth: 0, videoHeight: 0 }, new AbortController().signal, () => {}), /chưa có hình ảnh/)
  assert.equal(env.draws.length, 0)
  assert.equal(env.encodes.length, 0)
})

test('cancelling during the capture interval stops subsequent frames and encoding', async (t) => {
  const env = setupCanvas(t)
  const controller = new AbortController()
  const pending = captureFrames({ readyState: 2, videoWidth: 1280, videoHeight: 720 }, controller.signal, () => {})
  controller.abort()
  await assert.rejects(pending, { name: 'AbortError' })
  assert.equal(env.draws.length, 1)
  assert.equal(env.encodes.length, 0)
})

test('JPEG encoder failure is recoverable and produces no upload payload', async (t) => {
  const env = setupCanvas(t)
  env.frames[0].toBlob = (callback) => callback(null)
  await assert.rejects(compressFrames(env.frames, new AbortController().signal), /Không thể nén/)
})

test('browser canvas exceptions are replaced with Vietnamese recovery messages', async (t) => {
  const env = setupCanvas(t)
  env.frames[0].toBlob = () => { throw new DOMException('private encoder failure', 'SecurityError') }
  await assert.rejects(compressFrames(env.frames, new AbortController().signal), /Không thể nén/)
  replaceGlobal(t, 'document', {
    createElement: () => ({ getContext: () => ({ drawImage() { throw new Error('private decoder failure') } }) }),
  })
  await assert.rejects(captureFrames({ readyState: 2, videoWidth: 100, videoHeight: 100 }, new AbortController().signal, () => {}), /Không thể đọc khung hình/)
})
