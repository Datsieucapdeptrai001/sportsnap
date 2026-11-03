type Point = readonly [number, number]
interface Particle { x: number; y: number; vx: number; vy: number; life: number }

const WIDTH = 1000
const HEIGHT = 600
const FLOOR = 500
const FRAME_MS = 1000 / 60
const PARTICLE_LIMIT = 64
const INK = '#6ee7b7'

const clamp = (value: number): number => Math.max(0, Math.min(1, value))
const mix = (from: number, to: number, amount: number): number => from + (to - from) * amount
const ease = (value: number): number => { const t = clamp(value); return t * t * (3 - 2 * t) }

function line(ctx: CanvasRenderingContext2D, points: readonly Point[], width = 1): void {
  ctx.beginPath()
  ctx.lineWidth = width
  points.forEach(([x, y], index) => index ? ctx.lineTo(x, y) : ctx.moveTo(x, y))
  ctx.stroke()
}

function circle(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, fill = true): void {
  ctx.beginPath()
  ctx.arc(x, y, radius, 0, Math.PI * 2)
  if (fill) ctx.fill()
  else ctx.stroke()
}

function athlete(ctx: CanvasRenderingContext2D, hip: Point, arms: readonly Point[][], legs: readonly Point[][], lean: number): void {
  const [x, y] = hip
  ctx.fillStyle = INK
  ctx.strokeStyle = INK
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  legs.forEach((leg) => line(ctx, [[x, y], ...leg], 15))
  arms.forEach((arm) => line(ctx, [[x + lean, y - 48], ...arm], 10))
  ctx.beginPath()
  ctx.moveTo(x - 14, y + 2)
  ctx.lineTo(x + 15, y + 2)
  ctx.lineTo(x + lean + 20, y - 49)
  ctx.quadraticCurveTo(x + lean, y - 60, x + lean - 19, y - 49)
  ctx.closePath()
  ctx.fill()
  line(ctx, [[x + lean, y - 49], [x + lean, y - 65]], 11)
  circle(ctx, x + lean, y - 77, 12)
}

function court(ctx: CanvasRenderingContext2D, basketball: boolean): void {
  ctx.save()
  ctx.globalAlpha *= 0.22
  ctx.strokeStyle = INK
  for (let y = 320; y <= 560; y += 40) line(ctx, [[30, y], [980, y]])
  for (let x = -300; x <= 1400; x += 170) line(ctx, [[500 + (x - 500) * 0.4, 320], [x, 560]])
  ctx.beginPath()
  ctx.ellipse(500, FLOOR, basketball ? 120 : 150, 35, 0, 0, Math.PI * 2)
  ctx.stroke()
  ctx.restore()
}

function goal(ctx: CanvasRenderingContext2D, impactAge: number): void {
  const ripple = (x: number, y: number): number => {
    const distance = Math.hypot(x - 905, y - 359)
    return impactAge < 0 ? 0 : 18 * Math.exp(-impactAge * 2 - distance / 140) * Math.sin(impactAge * 11 - distance * 0.03)
  }
  ctx.strokeStyle = INK
  ctx.save()
  ctx.globalAlpha *= 0.4
  for (let x = 865; x <= 980; x += 14) {
    const points: Point[] = []
    for (let y = 265; y <= FLOOR; y += 16) points.push([x + ripple(x, y), y])
    line(ctx, points)
  }
  for (let y = 265; y <= FLOOR; y += 16) {
    const points: Point[] = []
    for (let x = 865; x <= 980; x += 14) points.push([x + ripple(x, y), y])
    line(ctx, points)
  }
  ctx.restore()
  line(ctx, [[865, FLOOR], [865, 265], [980, 265], [980, FLOOR]], 4)
}

function hoop(ctx: CanvasRenderingContext2D, impactAge: number): void {
  ctx.strokeStyle = INK
  line(ctx, [[960, FLOOR], [960, 155], [915, 155]], 5)
  ctx.strokeRect(900, 145, 12, 145)
  const stretch = impactAge < 0 ? 0 : Math.sin(impactAge * 15) * Math.exp(-impactAge * 3) * 14
  ctx.save()
  ctx.globalAlpha *= 0.5
  for (let i = 0; i <= 8; i++) {
    line(ctx, [[822 + i * 11, 245], [839 + i * 7, 300 + stretch]])
  }
  for (let i = 1; i <= 4; i++) {
    const t = i / 4
    line(ctx, [[822 + 17 * t, 245 + (55 + stretch) * t], [910 - 15 * t, 245 + (55 + stretch) * t]])
  }
  ctx.restore()
  ctx.beginPath()
  ctx.lineWidth = 4
  ctx.ellipse(866, 245, 44, 9, 0, 0, Math.PI * 2)
  ctx.stroke()
}

function football(ctx: CanvasRenderingContext2D, phase: number): Point {
  const kick = ease((phase - 1.25) / 0.35)
  const follow = ease((phase - 1.6) / 0.35)
  const recover = ease((phase - 2) / 0.7)
  const hip: Point = [265, 420 + Math.sin(phase * 2) * 2]
  const [x, y] = hip
  const knee: Point = [x + mix(mix(-8, 31, kick), mix(39, 8, recover), follow), y + mix(mix(32, 37, kick), mix(4, 40, recover), follow)]
  const ankle: Point = [x + mix(mix(-45, 65, kick), mix(75, 14, recover), follow), y + mix(mix(61, 69, kick), mix(-4, 80, recover), follow)]
  athlete(ctx, hip,
    [[[x - 38, y - 30], [x - 55, y - 52]], [[x + 29, y - 32], [x + 44, y - 44]]],
    [[[x - 13, y + 40], [x - 16, FLOOR]], [knee, ankle, [ankle[0] + 12, ankle[1] + 2]]],
    mix(-8, 9, kick) * (1 - recover),
  )
  const flight = phase - 1.6
  const impactAge = flight - 2.5
  goal(ctx, impactAge)
  if (flight < 0) return [342, 490]
  if (impactAge < 0) return [342 + 210 * flight + 6 * flight ** 2, 490 - 240 * flight + 75 * flight ** 2]
  return [905 + 18 * Math.exp(-impactAge * 2.2) * Math.sin(impactAge * 9), 359 + 130 * (1 - Math.exp(-impactAge * 1.2))]
}

function bouncingY(time: number): number {
  // Solve each ballistic segment exactly, then apply a damped floor rebound.
  let y = 213.6
  let velocity = 115
  for (let bounce = 0; bounce < 5; bounce++) {
    const hit = (-velocity + Math.sqrt(velocity ** 2 + 520 * (488 - y))) / 260
    if (time <= hit) return y + velocity * time + 130 * time ** 2
    time -= hit
    velocity = -(velocity + 260 * hit) * 0.55
    y = 488
  }
  return 488
}

function basketball(ctx: CanvasRenderingContext2D, phase: number): Point {
  const flight = Math.max(0, phase - 1.4)
  const jump = Math.min(flight, 1.2)
  const landing = Math.max(0, flight - 1.2)
  const x = phase < 1.4 ? 210 + 85 * phase : 329 + 400 * jump + Math.min(landing, 1) * 15
  const y = phase < 1.4 ? 420 - Math.abs(Math.sin(phase * 8)) * 6 : Math.min(420, 420 - 270 * jump + 90 * jump ** 2 + 130 * landing + 90 * landing ** 2)
  const reach = ease(flight / 1.2)
  const arm: Point[] = [[x + 30, y - 92 + 70 * reach], [x + 65, y - 110 + 110 * reach]]
  const tuck = Math.sin(clamp(flight / 2.2) * Math.PI)
  athlete(ctx, [x, y], [arm, [[x - 28, y - 26], [x - 40, y - 5]]],
    [[[x - 18, y + 35], [x - 25 - tuck * 25, y + 80 - tuck * 40]], [[x + 24, y + 32], [x + 35, y + 80 - tuck * 30]]], -5)
  hoop(ctx, phase - 2.82)
  if (phase < 2.6) return [arm[1][0], arm[1][1] - 12]
  return [874 + Math.sin((phase - 2.6) * 2) * 5, bouncingY(phase - 2.6)]
}

export function startSportCanvas(canvas: HTMLCanvasElement): () => void {
  const context = canvas.getContext('2d')
  if (!context) return () => {}
  const ctx: CanvasRenderingContext2D = context

  // Cache a glow sprite instead of applying shadowBlur to every particle/frame.
  const glow = document.createElement('canvas')
  glow.width = glow.height = 64
  const glowContext = glow.getContext('2d')
  if (glowContext) {
    const gradient = glowContext.createRadialGradient(32, 32, 0, 32, 32, 32)
    gradient.addColorStop(0, '#a7f3d0')
    gradient.addColorStop(0.2, '#34d39990')
    gradient.addColorStop(1, '#10b98100')
    glowContext.fillStyle = gradient
    glowContext.fillRect(0, 0, 64, 64)
  }

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
  const particles: Particle[] = Array.from({ length: PARTICLE_LIMIT }, () => ({ x: 0, y: 0, vx: 0, vy: 0, life: 0 }))
  let cursor = 0
  let raf: number | undefined
  let disposed = false
  let width = 1
  let height = 1
  let density = 1
  let scale = 1
  let offsetX = 0
  let offsetY = 0
  let time = 0
  let lastPaint: number | undefined
  let lastUpdate: number | undefined
  let emission = 0
  let lastScene = 0
  let lastPhase = 0
  const pointer = { x: 0, y: 0, seenAt: -Infinity }

  function spawn(x: number, y: number, burst = false): void {
    const particle = particles[cursor++ % PARTICLE_LIMIT]
    const angle = Math.random() * Math.PI * 2
    const speed = burst ? 45 + Math.random() * 95 : 10 + Math.random() * 25
    Object.assign(particle, { x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 20, life: burst ? 1.3 : 0.7 })
  }

  function paint(dt: number): void {
    ctx.setTransform(density, 0, 0, density, 0, 0)
    ctx.clearRect(0, 0, width, height)
    ctx.translate(offsetX, offsetY)
    ctx.scale(scale, scale)
    const scene = Math.floor(time / 8) % 2
    const phase = time % 8
    if (scene !== lastScene || phase < lastPhase) {
      particles.forEach((particle) => { particle.life = 0 })
      lastPhase = 0
      emission = 0
    }
    ctx.globalAlpha = Math.min(1, (8 - phase) / 0.45, phase / 0.45 + (time < 0.45 ? 1 : 0))
    court(ctx, scene === 1)
    const ball = scene === 0 ? football(ctx, phase) : basketball(ctx, phase)
    const impact = scene === 0 ? 4.1 : 2.82
    if (dt > 0) {
      emission += dt * 32
      while (emission >= 1) { spawn(ball[0], ball[1]); emission-- }
      if (lastPhase < impact && phase >= impact) {
        for (let i = 0; i < 20; i++) spawn(ball[0], ball[1], true)
      }
    }
    const pointerActive = performance.now() - pointer.seenAt < 2000 && !reducedMotion.matches
    ctx.fillStyle = INK
    for (const particle of particles) {
      if (particle.life <= 0) continue
      if (dt > 0) {
        const dx = particle.x - pointer.x
        const dy = particle.y - pointer.y
        const distance = Math.hypot(dx, dy)
        if (pointerActive && distance > 1 && distance < 100) {
          const force = (1 - distance / 100) * 500 * dt
          particle.vx += dx / distance * force
          particle.vy += dy / distance * force
        }
        particle.vx *= Math.exp(-1.2 * dt)
        particle.vy += 45 * dt
        particle.x += particle.vx * dt
        particle.y += particle.vy * dt
        particle.life -= dt
      }
      ctx.save()
      ctx.globalAlpha *= clamp(particle.life) * 0.8
      ctx.drawImage(glow, particle.x - 7, particle.y - 7, 14, 14)
      circle(ctx, particle.x, particle.y, 1.5)
      ctx.restore()
    }
    if (pointerActive) {
      ctx.save()
      ctx.globalAlpha *= 0.25
      ctx.drawImage(glow, pointer.x - 80, pointer.y - 80, 160, 160)
      ctx.restore()
    }
    ctx.drawImage(glow, ball[0] - 32, ball[1] - 32, 64, 64)
    ctx.fillStyle = '#a7f3d0'
    circle(ctx, ball[0], ball[1], scene === 0 ? 9 : 12)
    ctx.strokeStyle = '#064e3b'
    ctx.lineWidth = 1.5
    if (scene === 1) {
      line(ctx, [[ball[0] - 11, ball[1]], [ball[0] + 11, ball[1]]], 1.5)
      line(ctx, [[ball[0], ball[1] - 11], [ball[0], ball[1] + 11]], 1.5)
    } else {
      circle(ctx, ball[0], ball[1], 4, false)
    }
    ctx.globalAlpha = 1
    lastScene = scene
    lastPhase = phase
  }

  function frame(now: number): void {
    raf = undefined
    if (disposed || document.hidden || reducedMotion.matches) return
    if (lastPaint === undefined || now - lastPaint >= FRAME_MS - 0.2) {
      const dt = lastUpdate === undefined ? 0 : Math.min((now - lastUpdate) / 1000, 0.05)
      lastUpdate = now
      // Advance a deadline without a floating-point modulo wrap at 120/144 Hz.
      lastPaint = lastPaint === undefined || now - lastPaint >= FRAME_MS * 2 ? now : lastPaint + FRAME_MS
      time += dt
      paint(dt)
    }
    raf = window.requestAnimationFrame(frame)
  }

  function syncPlayback(): void {
    if (raf !== undefined) window.cancelAnimationFrame(raf)
    raf = undefined
    lastPaint = lastUpdate = undefined
    if (disposed || document.hidden) return
    if (reducedMotion.matches) paint(0)
    else raf = window.requestAnimationFrame(frame)
  }

  function resize(): void {
    width = Math.max(1, canvas.clientWidth)
    height = Math.max(1, canvas.clientHeight)
    const budget = width < 768 ? 650_000 : 1_250_000
    density = Math.min(window.devicePixelRatio || 1, 1.5, Math.sqrt(budget / (width * height)))
    canvas.width = Math.max(1, Math.floor(width * density))
    canvas.height = Math.max(1, Math.floor(height * density))
    scale = Math.min(width / WIDTH, height / HEIGHT)
    offsetX = (width - WIDTH * scale) / 2
    offsetY = (height - HEIGHT * scale) / 2
    if (!document.hidden) paint(0)
  }

  function onPointer(event: PointerEvent): void {
    if (document.hidden || reducedMotion.matches) return
    pointer.x = (event.clientX - offsetX) / scale
    pointer.y = (event.clientY - offsetY) / scale
    pointer.seenAt = performance.now()
    if (event.type === 'pointerdown') {
      for (let i = 0; i < 8; i++) spawn(pointer.x, pointer.y, true)
    }
  }

  resize()
  syncPlayback()
  window.addEventListener('resize', resize)
  window.addEventListener('pointermove', onPointer, { passive: true })
  window.addEventListener('pointerdown', onPointer, { passive: true })
  document.addEventListener('visibilitychange', syncPlayback)
  reducedMotion.addEventListener('change', syncPlayback)
  return () => {
    disposed = true
    if (raf !== undefined) window.cancelAnimationFrame(raf)
    window.removeEventListener('resize', resize)
    window.removeEventListener('pointermove', onPointer)
    window.removeEventListener('pointerdown', onPointer)
    document.removeEventListener('visibilitychange', syncPlayback)
    reducedMotion.removeEventListener('change', syncPlayback)
  }
}
