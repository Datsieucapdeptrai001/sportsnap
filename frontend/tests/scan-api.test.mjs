import assert from 'node:assert/strict'
import test from 'node:test'
import { predictImage, scanFrames } from '../src/lib/api.ts'

test('scan uses repeated files fields, JPEG filenames and the abort signal', async (t) => {
  const controller = new AbortController()
  const result = { label: 'sample', agreement: 0.5, per_frame: [] }
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, '/api/scan')
    assert.equal(options.method, 'POST')
    assert.equal(options.signal, controller.signal)
    assert.deepEqual([...options.body.keys()], ['files', 'files'])
    assert.deepEqual(options.body.getAll('files').map((file) => file.name), ['frame-1.jpg', 'frame-2.jpg'])
    return Response.json(result)
  })
  assert.deepEqual(await scanFrames([new Blob(['1']), new Blob(['2'])], controller.signal), result)
})

test('gallery upload continues to use predict with one file field', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, '/api/predict')
    assert.deepEqual([...options.body.keys()], ['file'])
    return Response.json({ label: 'sample' })
  })
  await predictImage(new File(['1'], 'photo.jpg'))
})

test('invalid frame counts fail before making a request', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', () => { throw new Error('unexpected request') })
  for (const count of [0, 1, 7]) await assert.rejects(scanFrames(Array(count).fill(new Blob())), /2 đến 6/)
  assert.equal(fetch.mock.callCount(), 0)
})

for (const [status, code, message] of [
  [400, 'bad_request', /chọn lại/], [413, 'file_too_large', /dung lượng/],
  [415, 'unsupported_format', /JPG/], [422, 'invalid_image', /bị hỏng/],
  [503, 'model_not_loaded', /chưa sẵn sàng/], [500, 'internal_error', /thử lại/],
]) {
  test(`scan handles ${status} ${code} with a safe Vietnamese message`, async (t) => {
    t.mock.method(globalThis, 'fetch', async () => Response.json({ error: { code, message: 'private server failure' } }, { status }))
    await assert.rejects(scanFrames([new Blob(), new Blob()]), (error) => {
      assert.match(error.message, message)
      assert.doesNotMatch(error.message, /private/)
      return true
    })
  })
}

test('network failures show a recovery message', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => { throw new TypeError('private network error') })
  await assert.rejects(scanFrames([new Blob(), new Blob()]), /kiểm tra mạng/)
})

test('malformed successful responses show a safe error', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('invalid json'))
  await assert.rejects(scanFrames([new Blob(), new Blob()]), /Không đọc được kết quả/)
})

test('aborted requests preserve cancellation rather than presenting a network error', async (t) => {
  const controller = new AbortController()
  controller.abort()
  t.mock.method(globalThis, 'fetch', async () => { throw controller.signal.reason })
  await assert.rejects(scanFrames([new Blob(), new Blob()], controller.signal), { name: 'AbortError' })
})
