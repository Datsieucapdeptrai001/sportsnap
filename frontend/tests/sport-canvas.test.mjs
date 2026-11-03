import assert from 'node:assert/strict'
import test from 'node:test'
import { startSportCanvas } from '../src/lib/sport-canvas.ts'

class Events {
  listeners = new Map()
  options = new Map()
  addEventListener(name, listener, options) {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set())
    this.listeners.get(name).add(listener)
    this.options.set(name, options)
  }
  removeEventListener(name, listener) { this.listeners.get(name)?.delete(listener) }
  emit(name, event = {}) {
    for (const listener of this.listeners.get(name) ?? []) listener({ type: name, ...event })
  }
  count() { return [...this.listeners.values()].reduce((total, set) => total + set.size, 0) }
}

function setup(t, { reduced = false, hidden = false, noContext = false } = {}) {
  let paints = 0
  const context = new Proxy({ globalAlpha: 1 }, {
    get(target, name) {
      if (name in target) return target[name]
      if (name === 'createRadialGradient') return () => ({ addColorStop() {} })
      return (...args) => {
        for (const value of args) if (typeof value === 'number') assert.ok(Number.isFinite(value), `${String(name)} received a non-finite coordinate`)
        if (name === 'clearRect') paints++
      }
    },
    set(target, name, value) {
      if (typeof value === 'number') assert.ok(Number.isFinite(value))
      if (name === 'shadowBlur') assert.equal(value, 0, 'per-frame shadows should use the cached glow sprite')
      target[name] = value
      return true
    },
  })
  const media = Object.assign(new Events(), { matches: reduced })
  const frames = new Map()
  let nextFrame = 0
  const windowStub = Object.assign(new Events(), {
    devicePixelRatio: 3,
    matchMedia: () => media,
    requestAnimationFrame: (callback) => { frames.set(++nextFrame, callback); return nextFrame },
    cancelAnimationFrame: (id) => frames.delete(id),
  })
  const documentStub = Object.assign(new Events(), {
    hidden,
    createElement: () => ({ getContext: () => context }),
  })
  const previous = ['window', 'document'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)])
  Object.defineProperty(globalThis, 'window', { configurable: true, value: windowStub })
  Object.defineProperty(globalThis, 'document', { configurable: true, value: documentStub })
  const canvas = { clientWidth: 390, clientHeight: 844, width: 0, height: 0, getContext: () => noContext ? null : context }
  const stop = startSportCanvas(canvas)
  t.after(() => {
    stop()
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  })
  return {
    canvas, window: windowStub, document: documentStub, media, frames, stop,
    paints: () => paints,
    step(now) {
      const callbacks = [...frames.values()]
      frames.clear()
      for (const callback of callbacks) callback(now)
      assert.ok(frames.size <= 1, 'only one frame may be scheduled')
    },
  }
}

for (const refreshRate of [60, 120, 144]) {
  test(`${refreshRate} Hz displays stay near 60 draws per second and both sport loops produce finite geometry`, (t) => {
    const env = setup(t)
    const before = env.paints()
    for (let tick = 0; tick <= refreshRate; tick++) env.step(tick * 1000 / refreshRate)
    assert.ok(env.paints() - before >= 59)
    assert.ok(env.paints() - before <= 62)
    for (let tick = refreshRate + 1; tick <= refreshRate * 18; tick++) env.step(tick * 1000 / refreshRate)
    assert.equal(env.frames.size, 1)
  })
}

test('hidden tabs cancel work and resume with a single fresh animation frame', (t) => {
  const env = setup(t)
  env.step(0)
  env.step(17)
  env.document.hidden = true
  env.document.emit('visibilitychange')
  assert.equal(env.frames.size, 0)
  const paused = env.paints()
  env.step(60_000)
  assert.equal(env.paints(), paused)
  env.document.hidden = false
  env.document.emit('visibilitychange')
  assert.equal(env.frames.size, 1)
  env.step(60_017)
  assert.equal(env.paints(), paused + 1)
})

test('reduced motion draws a still frame and ignores pointer animation', (t) => {
  const env = setup(t, { reduced: true })
  assert.equal(env.frames.size, 0)
  const still = env.paints()
  env.window.emit('pointerdown', { clientX: 100, clientY: 200 })
  env.step(1000)
  assert.equal(env.paints(), still)
  env.media.matches = false
  env.media.emit('change')
  assert.equal(env.frames.size, 1)
  env.media.matches = true
  env.media.emit('change')
  assert.equal(env.frames.size, 0)
})

test('viewport changes respect mobile and desktop backing-buffer budgets', (t) => {
  const env = setup(t)
  assert.ok(env.canvas.width * env.canvas.height <= 650_000)
  env.canvas.clientWidth = 3840
  env.canvas.clientHeight = 2160
  env.window.emit('resize')
  assert.ok(env.canvas.width * env.canvas.height <= 1_250_000)
  env.canvas.clientWidth = 0
  env.canvas.clientHeight = 0
  env.window.emit('resize')
  assert.ok(env.canvas.width >= 1 && env.canvas.height >= 1)
})

test('pointer effects use passive listeners and unmount removes all listeners and frames', (t) => {
  const env = setup(t)
  assert.equal(env.window.options.get('pointermove').passive, true)
  assert.equal(env.window.options.get('pointerdown').passive, true)
  env.window.emit('pointermove', { clientX: 100, clientY: 300 })
  env.window.emit('pointerdown', { clientX: 100, clientY: 300 })
  env.step(0)
  env.step(17)
  env.stop()
  assert.equal(env.frames.size, 0)
  assert.equal(env.window.count() + env.document.count() + env.media.count(), 0)
})

test('a missing Canvas 2D context leaves a safe static CSS fallback', (t) => {
  const env = setup(t, { noContext: true })
  assert.equal(env.frames.size, 0)
  assert.equal(env.window.count() + env.document.count() + env.media.count(), 0)
})
