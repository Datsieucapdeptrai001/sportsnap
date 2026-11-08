import assert from 'node:assert/strict'
import test from 'node:test'
import { AR_LAUNCH_FAILURE, createCameraArHandoff, releaseCameraForAr } from '../src/lib/ar.ts'

function setup(t) {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const events = []
  const states = []
  let visible = true
  let focused = true
  let resumes = 0
  let stops = 0
  const tracks = [0, 1].map(index => ({ stop() { events.push(`stop-${index}`) } }))
  const stream = { getTracks: () => tracks }
  const video = { srcObject: stream, pause() { events.push('pause') } }
  const handoff = createCameraArHandoff({
    stopCamera() { stops++; releaseCameraForAr(video, stream) },
    resumeCamera() { resumes++; events.push('resume') },
    isVisible: () => visible,
    isFocused: () => focused,
    onChange: state => states.push(state),
  })
  t.after(() => handoff.dispose())
  return { handoff, video, events, states, get resumes() { return resumes }, get stops() { return stops },
    set visible(value) { visible = value }, set focused(value) { focused = value } }
}

test('a stale camera request releases its tracks without pausing a replacement stream', () => {
  const current = { getTracks: () => [] }
  let stopped = false
  const stale = { getTracks: () => [{ stop() { stopped = true } }] }
  const video = { srcObject: current, pause() { assert.fail('replacement camera must keep playing') } }
  releaseCameraForAr(video, stale)
  assert.equal(stopped, true)
  assert.equal(video.srcObject, current)
})

test('AR tap pauses video, stops every track and detaches it before synchronous activation', async t => {
  const env = setup(t)
  let inTap = true
  env.handoff.launch(() => {
    assert.equal(inTap, true, 'activation must not move to a later task or microtask')
    assert.deepEqual(env.events, ['pause', 'stop-0', 'stop-1'])
    assert.equal(env.video.srcObject, null)
    env.events.push('activate')
    return Promise.resolve()
  })
  inTap = false
  env.handoff.launch(() => { assert.fail('double tap must not launch again') })
  await Promise.resolve()
  assert.equal(env.stops, 1)
  assert.equal(env.resumes, 0, 'resolved activateAR does not prove native AR opened or returned')
  assert.equal(env.states.at(-1).phase, 'launching')
})

for (const settlement of ['resolved', 'pending']) {
  test(`8 second watchdog restores camera for a ${settlement} activation without feedback`, async t => {
    const env = setup(t)
    env.handoff.launch(() => settlement === 'resolved' ? Promise.resolve() : new Promise(() => {}))
    await Promise.resolve()
    t.mock.timers.tick(7_999)
    assert.equal(env.resumes, 0)
    t.mock.timers.tick(1)
    assert.equal(env.resumes, 1)
    assert.deepEqual(env.states.at(-1), { phase: 'idle', message: AR_LAUNCH_FAILURE })
    assert.match(AR_LAUNCH_FAILURE, /Google Play Services for AR/)
    assert.match(AR_LAUNCH_FAILURE, /Mạng chậm/)
    env.handoff.focused()
    t.mock.timers.tick(8_000)
    assert.equal(env.resumes, 1)
  })
}

test('visibility return and focus reopen camera once, never while native AR has the page hidden', t => {
  const env = setup(t)
  env.handoff.launch(() => Promise.resolve())
  env.visible = false
  env.handoff.visibilityChanged(true)
  t.mock.timers.tick(20_000)
  env.handoff.focused()
  assert.equal(env.resumes, 0)
  assert.equal(env.states.at(-1).phase, 'away')
  env.visible = true
  env.handoff.visibilityChanged(false)
  env.handoff.focused()
  env.handoff.visibilityChanged(false)
  assert.equal(env.resumes, 1)
  assert.equal(env.states.at(-1).phase, 'idle')
})

test('focus return also recovers when native AR only caused a blur', t => {
  const env = setup(t)
  env.handoff.launch(() => Promise.resolve())
  env.focused = false
  env.handoff.blurred()
  env.focused = true
  env.handoff.focused()
  assert.equal(env.resumes, 1)
  t.mock.timers.tick(8_000)
  assert.equal(env.resumes, 1)
})

test('watchdog does not reopen camera behind an external viewer that only blurred the page', t => {
  const env = setup(t)
  env.handoff.launch(() => Promise.resolve())
  env.focused = false
  env.handoff.blurred()
  t.mock.timers.tick(8_000)
  assert.equal(env.resumes, 0)
  env.focused = true
  env.handoff.focused()
  assert.equal(env.resumes, 1)
})

for (const failure of ['throw', 'reject', 'status']) {
  test(`${failure} failure restores camera and permits a fresh tap without exposing raw errors`, async t => {
    const env = setup(t)
    env.handoff.launch(() => {
      if (failure === 'throw') throw new Error('private native failure')
      return failure === 'reject' ? Promise.reject(new Error('private native failure')) : Promise.resolve()
    })
    if (failure === 'status') env.handoff.status('failed')
    await Promise.resolve()
    assert.equal(env.resumes, 1)
    assert.deepEqual(env.states.at(-1), { phase: 'idle', message: AR_LAUNCH_FAILURE })
    env.handoff.launch(() => Promise.resolve())
    assert.equal(env.stops, 2)
    assert.deepEqual(env.states.at(-1), { phase: 'launching', message: '' })
  })
}

test('native failure while hidden defers camera reopening until page return', async t => {
  const env = setup(t)
  let reject
  env.handoff.launch(() => new Promise((_, failure) => { reject = failure }))
  env.visible = false
  env.handoff.visibilityChanged(true)
  reject(new Error('private failure'))
  await Promise.resolve()
  assert.equal(env.resumes, 0)
  env.visible = true
  env.handoff.visibilityChanged(false)
  env.handoff.focused()
  assert.equal(env.resumes, 1)
  assert.equal(env.states.at(-1).message, AR_LAUNCH_FAILURE)
})

test('session events keep camera stopped until AR ends and ignore initial not-presenting', t => {
  const env = setup(t)
  env.handoff.status('not-presenting')
  assert.equal(env.resumes, 0)
  env.handoff.launch(() => Promise.resolve())
  env.handoff.status('not-presenting')
  assert.equal(env.resumes, 0)
  env.handoff.status('session-started')
  env.handoff.status('object-placed')
  t.mock.timers.tick(8_000)
  assert.equal(env.resumes, 0)
  env.handoff.status('not-presenting')
  env.handoff.focused()
  assert.equal(env.resumes, 1)
})

test('manual return cancels watchdog and late rejection cannot interrupt a newer launch', async t => {
  const env = setup(t)
  let reject
  env.handoff.launch(() => new Promise((_, failure) => { reject = failure }))
  env.handoff.returnToCamera()
  assert.equal(env.resumes, 1)
  env.handoff.launch(() => Promise.resolve())
  reject(new Error('late failure'))
  await Promise.resolve()
  assert.equal(env.resumes, 1)
  assert.equal(env.states.at(-1).phase, 'launching')
})

test('unmount cancels timers and ignores late promises, status and page events', async t => {
  const env = setup(t)
  let reject
  env.handoff.launch(() => new Promise((_, failure) => { reject = failure }))
  env.handoff.dispose()
  const count = env.states.length
  t.mock.timers.tick(8_000)
  reject(new Error('late failure'))
  await Promise.resolve()
  env.handoff.status('failed')
  env.handoff.visibilityChanged(true)
  env.handoff.visibilityChanged(false)
  env.handoff.focused()
  env.handoff.returnToCamera()
  assert.equal(env.states.length, count)
  assert.equal(env.resumes, 0)
})
