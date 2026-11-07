import assert from 'node:assert/strict'
import test from 'node:test'
import { CAMERA_CONSTRAINTS, cameraErrorMessage, captureFrames, checkCameraSupport, compressFrames, getCropOverlay } from '../src/lib/camera.ts'

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
  const contexts = []
  const createCanvas = () => {
    const context = { drawImage: (...args) => draws.push(args) }
    contexts.push(context)
    return {
      width: 448, height: 448,
      getContext: () => context,
      toBlob(callback, type, quality) {
        encodes.push({ width: this.width, height: this.height, quality })
        callback(new Blob([new Uint8Array(size(this.width, quality))], { type }))
      },
    }
  }
  replaceGlobal(t, 'document', { createElement: () => createCanvas() })
  return { frames: Array.from({ length: 4 }, () => createCanvas()), encodes, draws, contexts }
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

test('camera requests rear-facing 1280x720 video without audio', () => {
  assert.deepEqual(CAMERA_CONSTRAINTS, {
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: false,
  })
})

test('ordinary scans retain four 448px JPEGs at quality 0.95 with multipart payload below 1.5 MB', async (t) => {
  const env = setupCanvas(t)
  const blobs = await compressFrames(env.frames, new AbortController().signal)
  assert.equal(blobs.length, 4)
  assert.ok(blobs.every((blob) => blob.type === 'image/jpeg'))
  assert.deepEqual(env.encodes, Array(4).fill({ width: 448, height: 448, quality: 0.95 }))
  const body = new FormData()
  blobs.forEach((blob, index) => body.append('files', blob, `frame-${index + 1}.jpg`))
  assert.ok((await new Response(body).blob()).size < 1_500_000)
})

for (const quality of [0.90, 0.85]) {
  test(`compression stops at quality ${quality} before dropping frames, without resizing`, async (t) => {
    const env = setupCanvas(t, (_width, current) => current > quality ? 400_000 : 300_000)
    const blobs = await compressFrames(env.frames, new AbortController().signal)
    assert.equal(blobs.length, 4)
    const qualities = [0.95, 0.90, 0.85]
    assert.deepEqual(env.encodes.map((item) => item.quality), qualities.slice(0, qualities.indexOf(quality) + 1).flatMap((value) => Array(4).fill(value)))
    assert.equal(env.draws.length, 0)
    assert.ok(env.encodes.every((item) => item.width === 448 && item.height === 448))
  })
}

for (const [frameSize, count] of [[490_000, 3], [700_000, 2]]) {
  test(`after all quality steps, compression retains ${count} frames at 448px within the payload limit`, async (t) => {
    const env = setupCanvas(t, () => frameSize)
    const blobs = await compressFrames(env.frames, new AbortController().signal)
    assert.equal(blobs.length, count)
    assert.deepEqual(env.encodes.map((item) => item.quality), [0.95, 0.90, 0.85].flatMap((value) => Array(4).fill(value)))
    assert.ok(env.encodes.every((item) => item.width === 448 && item.height === 448))
    assert.equal(env.draws.length, 0)
    const body = new FormData()
    blobs.forEach((blob, index) => body.append('files', blob, `frame-${index + 1}.jpg`))
    assert.ok((await new Response(body).blob()).size < 1_500_000)
  })
}

test('oversized scans fail without sending fewer than two frames', async (t) => {
  const env = setupCanvas(t, () => 800_000)
  await assert.rejects(compressFrames(env.frames, new AbortController().signal), /1,5 MB/)
})

for (const [width, height, previewWidth, previewHeight, expected] of [
  [1280, 720, 400, 300, { left: 87.5, top: 37.5, size: 225 }],
  [1080, 1920, 400, 300, { left: 115.625, top: 65.625, size: 168.75 }],
  [720, 720, 400, 300, { left: 50, top: 0, size: 300 }],
  [1280, 720, 300, 400, { left: 65.625, top: 115.625, size: 168.75 }],
  [1920, 1080, 1920, 1080, { left: 420, top: 0, size: 1080 }],
]) {
  test(`overlay maps ${width}x${height} video into a contained ${previewWidth}x${previewHeight} preview`, () => {
    assert.deepEqual(getCropOverlay(width, height, previewWidth, previewHeight), expected)
  })
}

test('overlay follows responsive preview sizing and camera rotation without clipping', () => {
  for (const width of [240, 320, 390, 768]) {
    for (const [videoWidth, videoHeight] of [[1280, 720], [720, 1280]]) {
      const height = width * 3 / 4
      const overlay = getCropOverlay(videoWidth, videoHeight, width, height)
      assert.ok(overlay)
      assert.equal(overlay.left + overlay.size / 2, width / 2)
      assert.equal(overlay.top + overlay.size / 2, height / 2)
      assert.ok(overlay.left >= 0 && overlay.top >= 0)
      assert.ok(overlay.left + overlay.size <= width && overlay.top + overlay.size <= height)
    }
  }
})

test('overlay is absent before metadata/layout is ready or dimensions are invalid', () => {
  for (const invalid of [0, -1, NaN, Infinity]) {
    for (let index = 0; index < 4; index++) {
      const dimensions = [1280, 720, 400, 300]
      dimensions[index] = invalid
      assert.equal(getCropOverlay(...dimensions), null)
    }
  }
})

for (const [width, height, crop] of [
  [1280, 720, [280, 0, 720, 720]],
  [1080, 1920, [0, 420, 1080, 1080]],
]) {
  test(`${width}x${height} video is center-cropped once to 448px square without stretching or mirroring`, async (t) => {
    const env = setupCanvas(t)
    const times = []
    const video = { readyState: 2, videoWidth: width, videoHeight: height, clientWidth: 240, clientHeight: 180 }
    const started = performance.now()
    const blobs = await captureFrames(video, new AbortController().signal, (count) => times.push({ count, time: performance.now() }))
    assert.equal(blobs.length, 4)
    assert.deepEqual(times.map((item) => item.count), [1, 2, 3, 4])
    assert.ok(times[0].time - started >= 480, 'first capture waits for 500ms warmup')
    for (let index = 1; index < times.length; index++) assert.ok(times[index].time - times[index - 1].time >= 280)
    assert.deepEqual(env.encodes, Array(4).fill({ width: 448, height: 448, quality: 0.95 }))
    assert.equal(env.draws.length, 4, 'one drawImage per captured frame')
    for (const args of env.draws) {
      assert.deepEqual(args, [video, ...crop, 0, 0, 448, 448])
      assert.equal(args[3] / args[4], args[7] / args[8], 'crop and output have the same aspect ratio')
      // Map the displayed overlay back into source pixels and compare it with
      // the actual drawImage crop, rather than testing only the guide in isolation.
      for (const [previewWidth, previewHeight] of [[240, 180], [390, 292.5], [300, 400]]) {
        const overlay = getCropOverlay(width, height, previewWidth, previewHeight)
        assert.ok(overlay)
        const scale = Math.min(previewWidth / width, previewHeight / height)
        const videoLeft = (previewWidth - width * scale) / 2
        const videoTop = (previewHeight - height * scale) / 2
        for (const [actual, expected] of [
          [(overlay.left - videoLeft) / scale, args[1]],
          [(overlay.top - videoTop) / scale, args[2]],
          [overlay.size / scale, args[3]],
          [overlay.size / scale, args[4]],
        ]) assert.ok(Math.abs(actual - expected) < 1e-8)
      }
    }
    assert.ok(env.contexts.slice(4).every((context) => context.imageSmoothingEnabled && context.imageSmoothingQuality === 'high'))
  })
}

test('capture waits for intrinsic video dimensions, then warms up before drawing', async (t) => {
  const env = setupCanvas(t)
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const video = { readyState: 0, videoWidth: 0, videoHeight: 0 }
  const controller = new AbortController()
  const pending = captureFrames(video, controller.signal, () => controller.abort())
  const rejection = assert.rejects(pending, { name: 'AbortError' })
  await t.mock.timers.tick(50)
  assert.equal(env.draws.length, 0)
  Object.assign(video, { readyState: 2, videoWidth: 1280, videoHeight: 720 })
  await t.mock.timers.tick(50)
  await t.mock.timers.tick(499)
  assert.equal(env.draws.length, 0)
  await t.mock.timers.tick(1)
  await rejection
  assert.equal(env.draws.length, 1)
  assert.equal(env.encodes.length, 0)
})

test('unready video is rejected before drawing or uploading', async (t) => {
  const env = setupCanvas(t)
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const rejection = assert.rejects(captureFrames({ readyState: 0, videoWidth: 0, videoHeight: 0 }, new AbortController().signal, () => {}), /chưa có hình ảnh/)
  for (let index = 0; index < 100; index++) await t.mock.timers.tick(50)
  await rejection
  assert.equal(env.draws.length, 0)
  assert.equal(env.encodes.length, 0)
})

test('cancelling during warmup stops all drawing and encoding', async (t) => {
  const env = setupCanvas(t)
  const controller = new AbortController()
  const pending = captureFrames({ readyState: 2, videoWidth: 1280, videoHeight: 720 }, controller.signal, () => {})
  controller.abort()
  await assert.rejects(pending, { name: 'AbortError' })
  assert.equal(env.draws.length, 0)
  assert.equal(env.encodes.length, 0)
})

test('cancelling during the capture interval stops subsequent frames and encoding', async (t) => {
  const env = setupCanvas(t)
  const controller = new AbortController()
  await assert.rejects(captureFrames(
    { readyState: 2, videoWidth: 1280, videoHeight: 720 }, controller.signal, () => controller.abort(),
  ), { name: 'AbortError' })
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
