import assert from 'node:assert/strict'
import test from 'node:test'
import { filterBulkItems, isBulkTerminal, pollBulkJob } from '../src/lib/bulk.ts'
import { cancelBulkJob, createBulkJob, downloadBulkJob, getBulkJob } from '../src/lib/api.ts'

const status = (state) => ({ status: state, processed: 1, total: 2, items: [], counts: {}, errors: 0, uncertain: 0, error: null })
const flush = () => new Promise((resolve) => setImmediate(resolve))

test('filter combines exact label and uncertainty without mutating results', () => {
  const items = [
    { filename: 'a', label: 'sport a', is_uncertain: false },
    { filename: 'b', label: 'sport a', is_uncertain: true },
    { filename: 'c', label: 'sport b', is_uncertain: true },
    { filename: 'd', label: null, is_uncertain: false, error: 'corrupt' },
  ]
  assert.deepEqual(filterBulkItems(items, '', false), items)
  assert.deepEqual(filterBulkItems(items, 'sport a', true).map((item) => item.filename), ['b'])
  assert.deepEqual(filterBulkItems(items, '', true).map((item) => item.filename), ['b', 'c'])
  assert.deepEqual(filterBulkItems(items, 'missing', false), [])
  assert.equal(items.length, 4)
})

for (const terminal of ['done', 'error', 'cancelled']) {
  test(`polls sequentially every 1s and stops at ${terminal}`, async () => {
    const states = ['queued', 'running', terminal]
    const updates = [], timers = []
    let inFlight = 0
    const stop = pollBulkJob('job', (job) => updates.push(job.status), assert.fail, {
      get: async (id, signal) => {
        assert.equal(id, 'job')
        assert.equal(signal.aborted, false)
        assert.equal(inFlight++, 0)
        await Promise.resolve()
        inFlight--
        return status(states.shift())
      },
      schedule: (callback, delay) => { assert.equal(delay, 1000); timers.push(callback); return timers.length },
      clear: () => {},
    })
    await flush()
    assert.deepEqual(updates, ['queued'])
    timers.shift()()
    await flush()
    timers.shift()()
    await flush()
    assert.deepEqual(updates, ['queued', 'running', terminal])
    assert.equal(timers.length, 0)
    assert.equal(isBulkTerminal(terminal), true)
    stop()
  })
}

test('stopping polling aborts in-flight fetch and ignores late results', async () => {
  let resolve, signal
  const updates = [], errors = []
  const stop = pollBulkJob('job', (job) => updates.push(job), (error) => errors.push(error), {
    get: (_id, receivedSignal) => { signal = receivedSignal; return new Promise((done) => { resolve = done }) },
    schedule: assert.fail, clear: assert.fail,
  })
  stop()
  assert.equal(signal.aborted, true)
  resolve(status('done'))
  await flush()
  assert.deepEqual(updates, [])
  assert.deepEqual(errors, [])
})

test('stopping polling clears pending timer', async () => {
  const cleared = []
  const stop = pollBulkJob('job', () => {}, assert.fail, {
    get: async () => status('running'), schedule: () => 42, clear: (timer) => cleared.push(timer),
  })
  await flush()
  stop()
  assert.deepEqual(cleared, [42])
})

test('poll failure reports once and stops scheduling until user retries', async () => {
  const errors = []
  const stop = pollBulkJob('job', assert.fail, (error) => errors.push(error.message), {
    get: async () => { throw new Error('network failure') }, schedule: assert.fail, clear: assert.fail,
  })
  await flush()
  assert.deepEqual(errors, ['network failure'])
  stop()
})

test('bulk status, cancellation and ZIP download use the API module with abort signals', async (t) => {
  const signal = new AbortController().signal
  const calls = []
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push([url, options.method])
    assert.equal(options.signal, signal)
    return url.endsWith('/download') ? new Response('zip bytes') : Response.json(status('done'))
  })
  assert.equal((await getBulkJob('a/b', signal)).status, 'done')
  assert.equal((await cancelBulkJob('a/b', signal)).status, 'done')
  assert.equal(await (await downloadBulkJob('a/b', signal)).text(), 'zip bytes')
  assert.deepEqual(calls, [['/api/bulk/a%2Fb', 'GET'], ['/api/bulk/a%2Fb', 'DELETE'], ['/api/bulk/a%2Fb/download', 'GET']])
})

for (const [code, httpStatus, pattern] of [
  ['too_many_files', 413, /Số tệp/], ['file_too_large', 413, /Dung lượng/],
  ['job_not_ready', 409, /chưa sẵn sàng/], ['job_expired', 410, /hết hạn/],
  ['job_not_found', 404, /Không tìm thấy/], ['model_not_loaded', 503, /Mô hình/],
  ['internal_error', 500, /thử lại/],
]) {
  test(`bulk reports ${code} safely in Vietnamese`, async (t) => {
    t.mock.method(globalThis, 'fetch', async () => Response.json({ error: { code, message: 'private failure' } }, { status: httpStatus }))
    await assert.rejects(getBulkJob('job'), (error) => {
      assert.match(error.message, pattern)
      assert.doesNotMatch(error.message, /private/)
      return true
    })
  })
}

test('bulk network and JSON errors use Vietnamese recovery messages', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new TypeError('private') })
  await assert.rejects(getBulkJob('job'), /kiểm tra mạng/)
  fetch.mock.mockImplementation(async () => new Response('bad json'))
  await assert.rejects(getBulkJob('job'), /Không đọc được kết quả/)
})

function mockXHR(t) {
  let current
  globalThis.XMLHttpRequest = class {
    upload = {}
    open(method, url) { this.method = method; this.url = url }
    send(body) { this.body = body; current = this }
    abort() { this.aborted = true; this.onabort() }
  }
  t.after(() => { delete globalThis.XMLHttpRequest })
  return () => current
}

test('bulk upload reports progress and sends repeated files fields', async (t) => {
  const current = mockXHR(t)
  const progress = []
  const promise = createBulkJob([new File(['a'], 'a.png'), new File(['b'], 'b.png')], (percent) => progress.push(percent))
  const xhr = current()
  assert.equal(xhr.url, '/api/bulk')
  assert.equal(xhr.method, 'POST')
  assert.deepEqual([...xhr.body.keys()], ['files', 'files'])
  xhr.upload.onprogress({ lengthComputable: true, loaded: 3, total: 4 })
  xhr.status = 202
  xhr.response = { job_id: 'new' }
  xhr.onload()
  assert.deepEqual(await promise, { job_id: 'new' })
  assert.deepEqual(progress, [75, 100])
})

test('bulk upload abort cancels XHR', async (t) => {
  const current = mockXHR(t)
  const controller = new AbortController()
  const promise = createBulkJob([new File(['a'], 'a.png')], () => {}, controller.signal)
  controller.abort()
  await assert.rejects(promise, { name: 'AbortError' })
  assert.equal(current().aborted, true)
})

test('bulk upload rejects malformed success and server limits', async (t) => {
  const current = mockXHR(t)
  let promise = createBulkJob([], () => {})
  current().status = 202
  current().response = {}
  current().onload()
  await assert.rejects(promise, /Không đọc được mã/)
  promise = createBulkJob([], () => {})
  current().status = 413
  current().response = { error: { code: 'too_many_files' } }
  current().onload()
  await assert.rejects(promise, /Số tệp/)
})
