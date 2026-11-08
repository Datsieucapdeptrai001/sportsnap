import assert from 'node:assert/strict'
import test from 'node:test'
import { AR_VIEWER_ATTRIBUTES, CAMERA_AR_RELEASE_MS, createCameraArHandoff, releaseCameraForAr } from '../src/lib/ar.ts'

function setup(t) {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const events = []
  let visible = true
  let phase = 'camera'
  let resumes = 0
  const stream = { getTracks: () => [0, 1].map(index => ({ stop() { events.push(`stop-${index}`) } })) }
  const video = { srcObject: stream, pause() { events.push('pause') } }
  const handoff = createCameraArHandoff({
    stopCamera() { releaseCameraForAr(video, stream); events.push('stop camera') },
    resumeCamera() { resumes++; events.push('resume camera') },
    isVisible: () => visible,
    onChange(next) { phase = next; if (next === 'dialog') events.push('open dialog') },
    log(step) { events.push(step) },
  })
  t.after(() => handoff.dispose())
  return { handoff, video, events, get phase() { return phase }, get resumes() { return resumes },
    set visible(value) { visible = value } }
}

function open(t, env) {
  env.handoff.begin()
  env.handoff.overlayRemoved()
  t.mock.timers.tick(CAMERA_AR_RELEASE_MS)
  assert.equal(env.phase, 'dialog')
}

test('both AR entry paths use the gallery dialog configuration unchanged', () => {
  assert.deepEqual(AR_VIEWER_ATTRIBUTES, {
    ar: true, 'ar-modes': 'webxr scene-viewer quick-look', 'ar-placement': 'floor',
    'ar-scale': 'auto', 'camera-controls': true, 'shadow-intensity': '1',
    'environment-image': 'neutral', loading: 'lazy',
  })
})

test('stop all tracks -> acknowledged overlay unmount -> release delay -> open dialog', t => {
  const env = setup(t)
  env.handoff.begin()
  assert.equal(env.video.srcObject, null)
  assert.deepEqual(env.events.slice(0, 4), ['pause', 'stop-0', 'stop-1', 'stop camera'])
  assert.equal(env.phase, 'releasing')
  t.mock.timers.tick(2_000)
  assert.equal(env.phase, 'releasing', 'timer must not start before React acknowledges removal')
  env.handoff.overlayRemoved()
  t.mock.timers.tick(CAMERA_AR_RELEASE_MS - 1)
  assert.equal(env.phase, 'releasing')
  t.mock.timers.tick(1)
  assert.equal(env.phase, 'dialog')
  assert.ok(env.events.indexOf('stop camera') < env.events.indexOf('unmount overlay model-viewer'))
  assert.ok(env.events.indexOf('unmount overlay model-viewer') < env.events.indexOf('open dialog'))
  assert.equal(env.resumes, 0)
})

test('closing removes dialog and waits for cleanup before restoring camera and overlay', t => {
  const env = setup(t)
  open(t, env)
  env.handoff.close()
  assert.equal(env.phase, 'restoring')
  t.mock.timers.tick(2_000)
  assert.equal(env.resumes, 0)
  env.handoff.dialogRemoved()
  t.mock.timers.tick(CAMERA_AR_RELEASE_MS - 1)
  assert.equal(env.resumes, 0)
  t.mock.timers.tick(1)
  assert.equal(env.phase, 'camera')
  assert.equal(env.resumes, 1)
})

test('double taps, duplicate React acknowledgements and focus do not open multiple dialogs or streams', t => {
  const env = setup(t)
  env.handoff.begin()
  env.handoff.begin()
  env.handoff.overlayRemoved()
  env.handoff.overlayRemoved()
  t.mock.timers.tick(CAMERA_AR_RELEASE_MS)
  assert.equal(env.events.filter(event => event === 'open dialog').length, 1)
  env.handoff.focused()
  assert.equal(env.phase, 'dialog', 'normal dialog focus must not close it')
  env.handoff.close()
  env.handoff.close()
  env.handoff.dialogRemoved()
  env.handoff.dialogRemoved()
  t.mock.timers.tick(CAMERA_AR_RELEASE_MS)
  env.handoff.focused()
  assert.equal(env.resumes, 1)
})

for (const signal of ['visibility', 'focus']) {
  test(`${signal} return closes native AR dialog before camera restarts`, t => {
    const env = setup(t)
    open(t, env)
    if (signal === 'visibility') {
      env.visible = false
      env.handoff.visibilityChanged(true)
      env.visible = true
      env.handoff.visibilityChanged(false)
    } else {
      env.handoff.blurred()
      env.handoff.focused()
    }
    assert.equal(env.phase, 'restoring')
    assert.equal(env.resumes, 0)
    env.handoff.dialogRemoved()
    t.mock.timers.tick(CAMERA_AR_RELEASE_MS)
    env.handoff.focused()
    env.handoff.visibilityChanged(false)
    assert.equal(env.resumes, 1)
  })
}

test('no dialog opens in a hidden tab and no camera restarts until visible', t => {
  const env = setup(t)
  env.handoff.begin()
  env.handoff.overlayRemoved()
  env.visible = false
  t.mock.timers.tick(CAMERA_AR_RELEASE_MS)
  assert.equal(env.phase, 'releasing')
  env.visible = true
  env.handoff.visibilityChanged(false)
  assert.equal(env.phase, 'dialog')
  env.visible = false
  env.handoff.close()
  env.handoff.dialogRemoved()
  t.mock.timers.tick(CAMERA_AR_RELEASE_MS)
  env.handoff.focused()
  assert.equal(env.resumes, 0)
  env.visible = true
  env.handoff.visibilityChanged(false)
  assert.equal(env.resumes, 1)
})

test('manual cancel during release prevents a late dialog from opening', t => {
  const env = setup(t)
  env.handoff.begin()
  env.handoff.overlayRemoved()
  env.handoff.close()
  env.handoff.dialogRemoved()
  t.mock.timers.tick(CAMERA_AR_RELEASE_MS * 2)
  assert.equal(env.phase, 'camera')
  assert.equal(env.events.includes('open dialog'), false)
  assert.equal(env.resumes, 1)
  open(t, env)
})

test('unmount cancels transitions without opening a dialog or restarting camera', t => {
  const env = setup(t)
  env.handoff.begin()
  env.handoff.overlayRemoved()
  env.handoff.dispose()
  const count = env.events.length
  t.mock.timers.tick(CAMERA_AR_RELEASE_MS)
  env.handoff.focused()
  env.handoff.close()
  env.handoff.dialogRemoved()
  assert.equal(env.events.length, count)
  assert.equal(env.resumes, 0)
})

test('a stale camera request releases its tracks without detaching a replacement stream', () => {
  const current = { getTracks: () => [] }
  let stopped = false
  const stale = { getTracks: () => [{ stop() { stopped = true } }] }
  const video = { srcObject: current, pause() { assert.fail('replacement must keep playing') } }
  releaseCameraForAr(video, stale)
  assert.equal(stopped, true)
  assert.equal(video.srcObject, current)
})
