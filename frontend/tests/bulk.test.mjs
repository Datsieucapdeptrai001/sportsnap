import assert from 'node:assert/strict'
import test from 'node:test'
import { BULK_PAGE_SIZE, bulkPagination, bulkResultsQuery, bulkStatusAfterRemoval, changeBulkFilters, initialBulkView, isBulkTerminal, moveBulkLightbox, pollBulkJob, toggleBulkLabel } from '../src/lib/bulk.ts'
import { cancelBulkJob, createBulkJob, downloadBulkJob, getBulkImageUrl, getBulkJob, getBulkResults, getBulkThumbnailUrl } from '../src/lib/api.ts'

const status = (state) => ({ status: state, processed: 1, total: 2, items: [], counts: {}, errors: 0, uncertain: 0, error: null })
const flush = () => new Promise((resolve) => setImmediate(resolve))

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

test('sport chip toggles its exact server label and resets pagination', () => {
  const original = { ...initialBulkView, page: 4, uncertain: true }
  const selected = toggleBulkLabel(original, 'polo')
  assert.equal(selected.label, 'polo')
  assert.equal(selected.page, 1)
  assert.equal(selected.uncertain, true)
  assert.equal(toggleBulkLabel(selected, 'polo').label, '')
  assert.equal(toggleBulkLabel(selected, 'football').label, 'football')
  assert.equal(original.page, 4)
})

for (const change of [{ label: '' }, { uncertain: true }, { sort: 'filename' }]) {
  test(`filter change ${JSON.stringify(change)} resets to page one`, () => {
    const updated = changeBulkFilters({ ...initialBulkView, label: 'polo', page: 4 }, change)
    assert.equal(updated.page, 1)
    for (const [key, value] of Object.entries(change)) assert.equal(updated[key], value)
  })
}

for (const [total, pages] of [[0, 1], [24, 1], [25, 2], [100, 5], [2000, 84]]) {
  test(`${total} results have ${pages} pages of 24`, () => {
    const pagination = bulkPagination(total, 1)
    assert.equal(pagination.page, 1)
    assert.equal(pagination.pages, pages)
    assert.ok(pagination.numbers.length <= 5)
  })
}

test('page numbers stay bounded at the beginning, middle and end', () => {
  assert.deepEqual(bulkPagination(2000, 40).numbers, [38, 39, 40, 41, 42])
  assert.deepEqual(bulkPagination(2000, 1000).numbers, [80, 81, 82, 83, 84])
  assert.equal(bulkPagination(100, -1).page, 1)
  assert.equal(bulkPagination(100, 999).page, 5)
})

test('view becomes a server query without slicing results locally', () => {
  assert.equal(BULK_PAGE_SIZE, 24)
  assert.deepEqual(bulkResultsQuery({ label: 'polo', uncertain: true, sort: 'confidence_asc', page: 4 }), {
    label: 'polo', uncertain: true, sort: 'confidence_asc', offset: 72, limit: 24,
  })
})

test('lightbox follows the current sorted page and wraps without treating index as position', () => {
  const items = [{ index: 91 }, { index: 7 }, { index: 75 }]
  assert.equal(moveBulkLightbox(items, 91, 1), 7)
  assert.equal(moveBulkLightbox(items, 7, -1), 91)
  assert.equal(moveBulkLightbox(items, 75, 1), 91)
  assert.equal(moveBulkLightbox(items, 91, -1), 75)
})

test('lightbox handles empty and single-image pages and stale selection', () => {
  assert.equal(moveBulkLightbox([], 0, 1), null)
  assert.equal(moveBulkLightbox([{ index: 72 }], 72, -1), 72)
  assert.equal(moveBulkLightbox([{ index: 72 }], 72, 1), 72)
  assert.equal(moveBulkLightbox([{ index: 72 }, { index: 80 }], 999, 1), 72)
})

test('results API sends filters, order and offset and preserves stable image indexes', async (t) => {
  const controller = new AbortController()
  const result = { items: Array.from({ length: 24 }, (_, index) => ({ index: 75 + index, label: 'polo' })), total: 25, offset: 0, limit: 24, summary: { total: 100, counts: { polo: 25 } } }
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const parsed = new URL(url, 'http://localhost')
    assert.equal(parsed.pathname, '/api/bulk/a%2Fb/results')
    assert.deepEqual(Object.fromEntries(parsed.searchParams), { label: 'polo', uncertain: 'true', sort: 'confidence_desc', offset: '0', limit: '24' })
    assert.equal(options.signal, controller.signal)
    return Response.json(result)
  })
  assert.deepEqual(await getBulkResults('a/b', { label: 'polo', uncertain: true, sort: 'confidence_desc', offset: 0, limit: 24 }, controller.signal), result)
})

test('thumbnail and full image URLs work for ZIP results without browser file references', () => {
  assert.equal(getBulkThumbnailUrl('a/b', 75), '/api/bulk/a%2Fb/thumb/75')
  assert.equal(getBulkImageUrl('a/b', 75), '/api/bulk/a%2Fb/image/75')
  for (const index of [-1, 0.5, NaN]) assert.throws(() => getBulkThumbnailUrl('job', index), /không hợp lệ/)
})

test('results request errors are safe in Vietnamese and respect abort', async (t) => {
  const query = bulkResultsQuery(initialBulkView)
  const fetch = t.mock.method(globalThis, 'fetch', async () => new Response('bad json'))
  await assert.rejects(getBulkResults('job', query), /Không đọc được kết quả/)
  fetch.mock.mockImplementation(async () => { throw new TypeError('private network failure') })
  await assert.rejects(getBulkResults('job', query), /kiểm tra mạng/)
  const controller = new AbortController()
  controller.abort()
  fetch.mock.mockImplementation(async () => { throw controller.signal.reason })
  await assert.rejects(getBulkResults('job', query, controller.signal), { name: 'AbortError' })
})
