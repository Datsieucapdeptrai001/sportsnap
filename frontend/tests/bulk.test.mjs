import assert from 'node:assert/strict'
import test from 'node:test'
import { bulkStatusAfterRemoval, createBulkPreviewUrls, filterBulkItems, isBulkTerminal, pairBulkPreviewItems, pollBulkJob } from '../src/lib/bulk.ts'
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

test('preview pairs by submitted index despite duplicate and sanitized filenames', () => {
  const files = [new File(['first'], 'same.png', { type: 'image/png' }), new File(['second'], 'same.png', { type: 'image/png' })]
  const items = [{ filename: 'same.png', label: 'a' }, { filename: 'same_2.png', label: 'b', is_uncertain: true }]
  const rows = pairBulkPreviewItems(items, files)
  assert.equal(rows[0].file, files[0])
  assert.equal(rows[1].file, files[1])
  const filtered = filterBulkItems(rows, 'b', true)
  assert.equal(filtered.length, 1)
  assert.equal(filtered[0].index, 1)
  assert.equal(filtered[0].file, files[1])
  assert.equal(items[1].index, undefined)
})

test('non-image and corrupt rows never shift subsequent file indexes', () => {
  const files = [new File(['notes'], 'notes.txt'), new File(['bad'], 'bad.png'), new File(['image'], 'actual.png')]
  const rows = pairBulkPreviewItems([
    { filename: 'notes.txt', error: 'unsupported_format' },
    { filename: 'bad.png', error: 'corrupt' },
    { filename: 'renamed.png', label: 'sport' },
  ], files)
  assert.equal(rows[0].file, undefined)
  assert.equal(rows[1].file, files[1])
  assert.equal(rows[2].file, files[2])
  assert.equal(rows[2].index, 2)
})

test('ZIP and missing local files have no image preview', () => {
  const items = [{ filename: 'nested.png' }, { filename: 'other.png' }]
  assert.ok(pairBulkPreviewItems(items, [new File(['zip'], 'photos.ZIP')]).every((row) => row.file === undefined))
  assert.ok(pairBulkPreviewItems(items, []).every((row) => row.file === undefined))
})

function objectUrlTracker() {
  const created = [], revoked = []
  const objectUrls = {
    createObjectURL(file) { const url = `blob:${created.length}`; created.push({ file, url }); return url },
    revokeObjectURL(url) { revoked.push(url) },
  }
  return { created, revoked, previews: createBulkPreviewUrls(objectUrls) }
}

test('2,000 submitted files allocate URLs only for the filtered first 50 preview rows', () => {
  const files = Array.from({ length: 2000 }, (_, index) => new File(['image'], `${index}.png`))
  const items = files.map((file, index) => ({ filename: file.name, label: index % 2 ? 'b' : 'a' }))
  const tracker = objectUrlTracker()
  const rows = pairBulkPreviewItems(items, files)
  assert.equal(rows.length, 50)
  assert.equal(tracker.created.length, 0)
  const filtered = filterBulkItems(rows, 'b', false)
  const leases = filtered.map((row) => tracker.previews.acquire(row.index, row.file))
  assert.equal(tracker.created.length, 25)
  assert.deepEqual(tracker.created.map((entry) => entry.file), filtered.map((row) => files[row.index]))
  leases.forEach((lease) => lease.release())
  assert.equal(tracker.revoked.length, 25)
})

test('retained rows reuse URLs while removed filter rows release theirs', () => {
  const tracker = objectUrlTracker()
  const files = [new File(['a'], 'a.png'), new File(['b'], 'b.png')]
  const first = tracker.previews.acquire(0, files[0])
  const second = tracker.previews.acquire(1, files[1])
  assert.equal(tracker.previews.acquire(1, files[1]).url, second.url)
  assert.equal(tracker.created.length, 2)
  first.release()
  assert.deepEqual(tracker.revoked, [first.url])
  const restored = tracker.previews.acquire(0, files[0])
  assert.notEqual(restored.url, first.url)
  assert.equal(tracker.created.length, 3)
  tracker.previews.clear()
  assert.equal(tracker.revoked.length, 3)
})

for (const lifecycle of ['new job', 'cancel/delete', 'new file list', 'unmount']) {
  test(`${lifecycle} revokes every preview URL and tolerates repeated effect cleanup`, () => {
    const tracker = objectUrlTracker()
    const first = tracker.previews.acquire(0, new File(['a'], 'a.png'))
    const second = tracker.previews.acquire(1, new File(['b'], 'b.png'))
    tracker.previews.clear()
    first.release()
    second.release()
    tracker.previews.clear()
    assert.deepEqual(tracker.revoked, [first.url, second.url])
    assert.equal(new Set(tracker.revoked).size, tracker.created.length)
  })
}

test('stale cleanup cannot revoke a replacement URL at the same index', () => {
  const tracker = objectUrlTracker()
  const old = tracker.previews.acquire(0, new File(['a'], 'same.png'))
  const replacement = tracker.previews.acquire(0, new File(['b'], 'same.png'))
  assert.deepEqual(tracker.revoked, [old.url])
  old.release()
  assert.deepEqual(tracker.revoked, [old.url])
  tracker.previews.clear()
  const nextJob = tracker.previews.acquire(0, new File(['next'], 'same.png'))
  replacement.release()
  assert.deepEqual(tracker.revoked, [old.url, replacement.url])
  nextJob.release()
  assert.equal(tracker.revoked.length, 3)
})

test('preview cache never retains more than 50 object URLs', () => {
  const tracker = objectUrlTracker()
  for (let index = 0; index < 50; index++) assert.ok(tracker.previews.acquire(index, new File(['image'], `${index}.png`)))
  assert.equal(tracker.previews.acquire(50, new File(['extra'], 'extra.png')), undefined)
  assert.equal(tracker.created.length, 50)
  tracker.previews.clear()
  assert.equal(tracker.revoked.length, 50)
})

test('deleting temporary files preserves the completed processing outcome', () => {
  const completed = { ...status('done'), processed: 100, total: 100 }
  const response = { ...completed, status: 'cancelled' }
  const visible = bulkStatusAfterRemoval(completed, response)
  assert.equal(visible.status, 'done')
  assert.equal(visible.processed, 100)
  assert.equal(response.status, 'cancelled')
  const failed = { ...status('error'), error: 'Lỗi phân loại.' }
  assert.equal(bulkStatusAfterRemoval(failed, { ...failed, status: 'cancelled' }).status, 'error')
})

test('real cancellation stays cancelled even when all images were processed', () => {
  for (const previous of [null, status('queued'), { ...status('running'), processed: 100, total: 100 }]) {
    const cancelled = { ...status('cancelled'), processed: 100, total: 100 }
    assert.equal(bulkStatusAfterRemoval(previous, cancelled).status, 'cancelled')
  }
})

test('polling a completed 100/100 job never sends a DELETE', async (t) => {
  const calls = []
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push([url, options.method])
    return Response.json({ ...status('done'), processed: 100, total: 100 })
  })
  const stop = pollBulkJob('complete', (job) => assert.equal(job.status, 'done'), assert.fail)
  await flush()
  stop()
  assert.deepEqual(calls, [['/api/bulk/complete', 'GET']])
})

test('default polling invokes browser timers without binding them to the dependencies object', async (t) => {
  const errors = [], updates = [], cleared = []
  let tick
  t.mock.method(globalThis, 'fetch', async () => Response.json(status('running')))
  t.mock.method(globalThis, 'setTimeout', function (callback, delay) {
    assert.ok(this === undefined || this === globalThis, 'browser timer received an illegal receiver')
    assert.equal(delay, 1000)
    tick = callback
    return 123
  })
  t.mock.method(globalThis, 'clearTimeout', function (timer) {
    assert.ok(this === undefined || this === globalThis, 'browser timer received an illegal receiver')
    cleared.push(timer)
  })
  const stop = pollBulkJob('job', (job) => updates.push(job.status), (error) => errors.push(error))
  await flush()
  assert.equal(typeof tick, 'function')
  tick()
  await flush()
  stop()
  assert.deepEqual(errors, [])
  assert.deepEqual(updates, ['running', 'running'])
  assert.deepEqual(cleared, [123])
})
