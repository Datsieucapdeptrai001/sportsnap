import { useCallback, useEffect, useRef, useState } from 'react'
import { Camera, RotateCcw, Sparkles, Trophy, Volume2, VolumeX } from 'lucide-react'
import {
  SHOOT_ATTEMPTS, SHOOT_FLIGHT_MS, TARGET_Y, TIMING_ATTEMPTS,
  getSportGame, highJumpBarHeight, landingFromSwipe, markerPos, mashScore, mashSnapshot, shootPoints, streakBonus,
  targetX, timingGrade, timingPoints, zoneAfterStreak,
  type Point, type SportGameConfig, type TargetKind,
} from '../../lib/interactive-ar/games'
import { soundEngine } from '../../lib/interactive-ar/sound-effects'
import { Button } from '../ui/button'
import { useCameraBackground } from './use-camera-background'

type Phase = 'ready' | 'playing' | 'over'

interface Fx { text: string; x: number; y: number; born: number; color: string }
interface Shot { landing: Point; start: number }
interface Round { center: number; zone: number; start: number; frozenUntil: number; frozenPos: number }
interface Runtime {
  phase: Phase
  score: number
  streak: number
  left: number
  startedAt: number
  swipe: { x: number; y: number; t: number } | null
  shot: Shot | null
  round: Round
  taps: number
  overAt: number | null
  result: 'win' | 'lose' | null
  lastHudAt: number
  fx: Fx[]
}

interface Hud {
  phase: Phase
  score: number
  streak: number
  left: number
  secondsLeft: number
  message: string
  result: 'win' | 'lose' | null
  best: number
}

const EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif'
const TEXT_FONT = 'system-ui,-apple-system,"Segoe UI",sans-serif'

function createRuntime(cfg: SportGameConfig): Runtime {
  return {
    phase: 'ready', score: 0, streak: 0,
    left: cfg.mode === 'shoot' ? SHOOT_ATTEMPTS : cfg.mode === 'timing' ? TIMING_ATTEMPTS : 1,
    startedAt: 0, swipe: null, shot: null,
    round: { center: 0.5, zone: cfg.zone ?? 0.2, start: 0, frozenUntil: 0, frozenPos: 0 },
    taps: 0, overAt: null, result: null, lastHudAt: 0, fx: [],
  }
}

function newRound(cfg: SportGameConfig, streak: number, now: number): Round {
  const zone = zoneAfterStreak(cfg.zone ?? 0.2, streak)
  const lo = zone / 2 + 0.05
  return { center: lo + Math.random() * (1 - 2 * lo), zone, start: now, frozenUntil: 0, frozenPos: 0 }
}

const bestKey = (label: string) => `sportsnap.ar-best.${label}`

function readBest(label: string): number {
  try {
    const value = Number(globalThis.localStorage?.getItem(bestKey(label)))
    return Number.isFinite(value) && value > 0 ? value : 0
  } catch {
    return 0
  }
}

function writeBest(label: string, value: number): void {
  try {
    globalThis.localStorage?.setItem(bestKey(label), String(value))
  } catch {
    // Storage can be blocked; the in-memory best is still shown.
  }
}

// ------------------------------------------------------------------ drawing

function emoji(ctx: CanvasRenderingContext2D, ch: string, x: number, y: number, size: number): void {
  ctx.font = `${Math.round(size)}px ${EMOJI_FONT}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(ch, x, y)
}

function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, color = '#fff', align: CanvasTextAlign = 'center'): void {
  ctx.font = `600 ${Math.round(size)}px ${TEXT_FONT}`
  ctx.textAlign = align
  ctx.textBaseline = 'middle'
  ctx.fillStyle = color
  ctx.fillText(text, x, y)
}

function drawTarget(ctx: CanvasRenderingContext2D, kind: TargetKind, cx: number, cy: number, r: number): void {
  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineWidth = Math.max(3, r * 0.08)
  if (kind === 'goal') {
    const w = r * 2
    const h = r * 1.2
    ctx.fillStyle = 'rgba(255,255,255,0.12)'
    ctx.fillRect(cx - w / 2, cy - h / 2, w, h)
    ctx.strokeStyle = 'rgba(255,255,255,0.45)'
    ctx.lineWidth = 1
    for (let i = 1; i < 8; i++) {
      ctx.beginPath(); ctx.moveTo(cx - w / 2 + (w * i) / 8, cy - h / 2); ctx.lineTo(cx - w / 2 + (w * i) / 8, cy + h / 2); ctx.stroke()
    }
    for (let i = 1; i < 4; i++) {
      ctx.beginPath(); ctx.moveTo(cx - w / 2, cy - h / 2 + (h * i) / 4); ctx.lineTo(cx + w / 2, cy - h / 2 + (h * i) / 4); ctx.stroke()
    }
    ctx.strokeStyle = '#fff'
    ctx.lineWidth = Math.max(3, r * 0.08)
    ctx.strokeRect(cx - w / 2, cy - h / 2, w, h)
  } else if (kind === 'uprights') {
    ctx.strokeStyle = '#fde047'
    ctx.beginPath()
    ctx.moveTo(cx - r, cy - r * 1.1); ctx.lineTo(cx - r, cy + r * 0.5)
    ctx.lineTo(cx + r, cy + r * 0.5); ctx.lineTo(cx + r, cy - r * 1.1)
    ctx.moveTo(cx, cy + r * 0.5); ctx.lineTo(cx, cy + r * 1.3)
    ctx.stroke()
  } else if (kind === 'bullseye') {
    const colors = ['#ffffff', '#ef4444', '#ffffff', '#ef4444']
    for (let i = 0; i < 4; i++) {
      ctx.beginPath(); ctx.arc(cx, cy, r * (1 - i * 0.25), 0, Math.PI * 2)
      ctx.fillStyle = colors[i]; ctx.fill()
    }
    ctx.beginPath(); ctx.arc(cx, cy, r * 0.1, 0, Math.PI * 2); ctx.fillStyle = '#fde047'; ctx.fill()
  } else if (kind === 'hole') {
    ctx.beginPath(); ctx.ellipse(cx, cy, r, r * 0.42, 0, 0, Math.PI * 2)
    ctx.fillStyle = '#0b0f19'; ctx.fill()
    ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.stroke()
    emoji(ctx, '⛳', cx + r * 0.2, cy - r * 1.1, r * 1.5)
  } else {
    const w = r * 2
    const h = r * 1.3
    ctx.fillStyle = 'rgba(34,197,94,0.35)'
    ctx.fillRect(cx - w / 2, cy - h / 2, w, h)
    ctx.strokeStyle = '#fff'
    ctx.strokeRect(cx - w / 2, cy - h / 2, w, h)
    ctx.beginPath(); ctx.moveTo(cx - r * 0.3, cy - r * 0.3); ctx.lineTo(cx + r * 0.3, cy + r * 0.3)
    ctx.moveTo(cx + r * 0.3, cy - r * 0.3); ctx.lineTo(cx - r * 0.3, cy + r * 0.3); ctx.stroke()
  }
  ctx.restore()
}

function bar(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, fill: number, color: string): void {
  ctx.fillStyle = 'rgba(0,0,0,0.45)'
  ctx.fillRect(x, y, w, h)
  ctx.fillStyle = color
  ctx.fillRect(x, y, w * Math.max(0, Math.min(1, fill)), h)
  ctx.strokeStyle = 'rgba(255,255,255,0.6)'
  ctx.lineWidth = 1.5
  ctx.strokeRect(x, y, w, h)
}

// -------------------------------------------------------------------- view

function GameView({ cfg, name }: { cfg: SportGameConfig; name: string }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rtRef = useRef<Runtime>(createRuntime(cfg))
  const soundRef = useRef(true)
  const camera = useCameraBackground(videoRef)
  const [soundOn, setSoundOn] = useState(true)
  const [hud, setHud] = useState<Hud>(() => ({
    phase: 'ready', score: 0, streak: 0,
    left: cfg.mode === 'mash' ? 1 : cfg.mode === 'shoot' ? SHOOT_ATTEMPTS : TIMING_ATTEMPTS,
    secondsLeft: cfg.seconds ?? 0, message: cfg.hint, result: null, best: readBest(name),
  }))

  const emit = useCallback((patch: Partial<Hud>) => setHud((previous) => ({ ...previous, ...patch })), [])

  const finish = useCallback((result: 'win' | 'lose' | null, finalScore: number) => {
    const rt = rtRef.current
    rt.phase = 'over'
    rt.result = result
    rt.overAt = null
    const previousBest = readBest(name)
    const best = Math.max(previousBest, finalScore)
    if (best > previousBest) writeBest(name, best)
    if (soundRef.current && result === 'win') soundEngine.playCheer()
    emit({ phase: 'over', score: finalScore, result, best, left: 0 })
  }, [emit, name])

  const start = useCallback(() => {
    const now = performance.now()
    const rt = createRuntime(cfg)
    rt.phase = 'playing'
    rt.startedAt = cfg.mode === 'mash' ? now + 700 : now
    if (cfg.mode === 'timing') rt.round = newRound(cfg, 0, now)
    rtRef.current = rt
    emit({
      phase: 'playing', score: 0, streak: 0, left: rt.left, secondsLeft: cfg.seconds ?? 0,
      message: cfg.mode === 'mash' ? 'Sẵn sàng… chạm liên tục!' : cfg.hint, result: null,
    })
  }, [cfg, emit])

  function toggleSound() {
    soundRef.current = !soundRef.current
    setSoundOn(soundRef.current)
  }

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let width = 0
    let height = 0
    let raf = 0

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      width = canvas.clientWidth
      height = canvas.clientHeight
      canvas.width = Math.max(1, Math.round(width * dpr))
      canvas.height = Math.max(1, Math.round(height * dpr))
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)

    const play = (kind: 'hit' | 'miss' | 'tap') => {
      if (!soundRef.current) return
      if (kind === 'hit') { soundEngine.playSwish(); soundEngine.playCheer() } else if (kind === 'miss') soundEngine.playBounce()
    }

    const addFx = (text: string, x: number, y: number, color: string, now: number) => {
      rtRef.current.fx.push({ text, x, y, born: now, color })
    }

    const scheduleEnd = (now: number) => { rtRef.current.overAt = now + 900 }

    // ---- inputs
    const onDown = (event: PointerEvent) => {
      const rt = rtRef.current
      const now = performance.now()
      if (rt.phase !== 'playing') return
      canvas.setPointerCapture?.(event.pointerId)
      if (cfg.mode === 'shoot') {
        if (!rt.shot && rt.left > 0 && !rt.overAt) rt.swipe = { x: event.clientX, y: event.clientY, t: now }
      } else if (cfg.mode === 'timing') tapTiming(now)
      else tapMash(now)
    }

    const onUp = (event: PointerEvent) => {
      const rt = rtRef.current
      const swipe = rt.swipe
      rt.swipe = null
      if (cfg.mode !== 'shoot' || !swipe || rt.phase !== 'playing' || rt.shot) return
      const now = performance.now()
      const landing = landingFromSwipe(event.clientX - swipe.x, event.clientY - swipe.y, now - swipe.t)
      if (!landing) { emit({ message: 'Vuốt thẳng lên trên để ném!' }); return }
      rt.shot = { landing, start: now }
      soundEngine.triggerHaptic('light')
      if (soundRef.current) soundEngine.playBounce()
      emit({ message: '' })
    }

    const onCancel = () => { rtRef.current.swipe = null }

    const onKey = (event: KeyboardEvent) => {
      if (cfg.mode === 'shoot' || rtRef.current.phase !== 'playing') return
      if (event.key !== ' ' && event.key !== 'Enter') return
      event.preventDefault()
      const now = performance.now()
      if (cfg.mode === 'timing') tapTiming(now)
      else tapMash(now)
    }

    function tapTiming(now: number) {
      const rt = rtRef.current
      if (rt.overAt || now < rt.round.frozenUntil || rt.left <= 0) return
      const pos = markerPos((now - rt.round.start) / 1000, cfg.sweepSpeed ?? 0.8)
      const grade = timingGrade(pos, rt.round.center, rt.round.zone)
      const base = timingPoints(grade)
      rt.streak = base > 0 ? rt.streak + 1 : 0
      const points = base > 0 ? base + streakBonus(rt.streak) : 0
      rt.score += points
      rt.left -= 1
      rt.round.frozenUntil = now + 700
      rt.round.frozenPos = pos
      const color = grade === 'miss' ? '#fca5a5' : grade === 'perfect' ? '#fde047' : '#86efac'
      addFx(grade === 'perfect' ? `HOÀN HẢO +${points}` : grade === 'good' ? `TỐT +${points}` : 'TRƯỢT', width / 2, height * 0.5, color, now)
      play(grade === 'miss' ? 'miss' : 'hit')
      soundEngine.triggerHaptic(grade === 'miss' ? 'medium' : 'success')
      emit({
        score: rt.score, streak: rt.streak, left: rt.left,
        message: grade === 'miss' ? 'Trượt rồi! Canh lại nhịp nhé.' : grade === 'perfect' ? 'Chuẩn từng mili-giây! 🎉' : 'Khá tốt!',
      })
      if (rt.left <= 0) scheduleEnd(now)
    }

    function tapMash(now: number) {
      const rt = rtRef.current
      if (now < rt.startedAt || rt.overAt) return
      rt.taps += 1
      soundEngine.triggerHaptic('light')
    }

    canvas.addEventListener('pointerdown', onDown)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    window.addEventListener('keydown', onKey)

    // ---- per-frame update
    const update = (now: number) => {
      const rt = rtRef.current
      if (rt.phase !== 'playing') return
      const aspect = width / Math.max(height, 1)

      if (rt.overAt && now >= rt.overAt) {
        finish(null, rt.score)
        return
      }

      if (cfg.mode === 'shoot' && rt.shot) {
        const u = (now - rt.shot.start) / SHOOT_FLIGHT_MS
        if (u >= 1) {
          const tx = targetX(now / 1000, cfg.targetSpeed ?? 0)
          const base = shootPoints(rt.shot.landing, { x: tx, y: TARGET_Y }, cfg.targetRadius ?? 0.18, aspect, cfg.rings ?? false)
          rt.streak = base > 0 ? rt.streak + 1 : 0
          const points = base > 0 ? base + streakBonus(rt.streak) : 0
          rt.score += points
          rt.left -= 1
          addFx(points > 0 ? `+${points}` : 'TRƯỢT', rt.shot.landing.x * width, rt.shot.landing.y * height, points > 0 ? '#fde047' : '#fca5a5', now)
          play(points > 0 ? 'hit' : 'miss')
          soundEngine.triggerHaptic(points > 0 ? 'success' : 'medium')
          emit({
            score: rt.score, streak: rt.streak, left: rt.left,
            message: points > 0 ? (rt.streak > 1 ? `TRÚNG! Chuỗi ${rt.streak} 🔥` : 'TRÚNG ĐÍCH! 🎉') : 'Trượt rồi! Thử lại nào.',
          })
          rt.shot = null
          if (rt.left <= 0) scheduleEnd(now)
        }
      }

      if (cfg.mode === 'timing' && !rt.overAt && rt.round.frozenUntil > 0 && now >= rt.round.frozenUntil && rt.left > 0) {
        rt.round = newRound(cfg, rt.streak, now)
      }

      if (cfg.mode === 'mash') {
        const elapsed = Math.max(0, (now - rt.startedAt) / 1000)
        const snap = mashSnapshot(rt.taps, elapsed, cfg.goal ?? 40, cfg.seconds ?? 10, cfg.rival ?? 4)
        if (snap.state !== 'running') {
          rt.overAt = now
          finish(snap.state === 'won' ? 'win' : 'lose', mashScore(snap))
          return
        }
        if (now - rt.lastHudAt > 200) {
          rt.lastHudAt = now
          emit({ secondsLeft: snap.secondsLeft, message: now < rt.startedAt ? 'Sẵn sàng… chạm liên tục!' : cfg.hint })
        }
      }
    }

    // ---- per-frame draw
    const draw = (now: number) => {
      const rt = rtRef.current
      ctx.clearRect(0, 0, width, height)
      const bob = reduced ? 0 : Math.sin(now * 0.004) * height * 0.008

      if (cfg.mode === 'shoot') {
        const r = (cfg.targetRadius ?? 0.18) * width
        const tx = targetX(now / 1000, cfg.targetSpeed ?? 0) * width
        const ty = TARGET_Y * height
        ctx.fillStyle = 'rgba(0,0,0,0.25)'
        ctx.fillRect(0, height * 0.72, width, height * 0.28)
        drawTarget(ctx, cfg.targetKind ?? 'goal', tx, ty, r)
        const size = Math.min(width * 0.13, 72)
        const sx = width / 2
        const sy = height * 0.88
        if (rt.shot) {
          const u = Math.min(1, (now - rt.shot.start) / SHOOT_FLIGHT_MS)
          const x = sx + (rt.shot.landing.x * width - sx) * u
          const y = sy + (rt.shot.landing.y * height - sy) * u - Math.sin(Math.PI * u) * height * 0.1
          emoji(ctx, cfg.prop, x, y, size * (1 - 0.55 * u))
        } else if (rt.phase === 'playing' && rt.left > 0) {
          emoji(ctx, cfg.prop, sx, sy + bob, size)
          if (!rt.swipe) label(ctx, '⬆ vuốt lên', sx, sy - size * 0.95, 13, 'rgba(255,255,255,0.8)')
        }
      } else if (cfg.mode === 'timing') {
        const x0 = width * 0.1
        const bw = width * 0.8
        const by = height * 0.62
        const bh = Math.max(20, height * 0.045)
        emoji(ctx, cfg.prop, width / 2, height * 0.3 + bob * 2, Math.min(width * 0.28, 140))
        ctx.fillStyle = 'rgba(0,0,0,0.5)'
        ctx.fillRect(x0, by, bw, bh)
        const zoneX = x0 + (rt.round.center - rt.round.zone / 2) * bw
        ctx.fillStyle = 'rgba(34,197,94,0.75)'
        ctx.fillRect(zoneX, by, rt.round.zone * bw, bh)
        ctx.fillStyle = 'rgba(253,224,71,0.9)'
        ctx.fillRect(x0 + (rt.round.center - rt.round.zone * 0.2) * bw, by, rt.round.zone * 0.4 * bw, bh)
        ctx.strokeStyle = '#fff'
        ctx.lineWidth = 2
        ctx.strokeRect(x0, by, bw, bh)
        const frozen = rt.round.frozenUntil > 0 && now < rt.round.frozenUntil
        const pos = frozen ? rt.round.frozenPos : markerPos((now - rt.round.start) / 1000, cfg.sweepSpeed ?? 0.8)
        if (name === 'high jump') {
          const barY = height * 0.44
          ctx.save()
          ctx.strokeStyle = 'rgba(255,255,255,0.35)'
          ctx.lineWidth = 3
          ctx.beginPath(); ctx.moveTo(width * 0.22, barY + 36); ctx.lineTo(width * 0.22, barY - 14); ctx.stroke()
          ctx.beginPath(); ctx.moveTo(width * 0.78, barY + 36); ctx.lineTo(width * 0.78, barY - 14); ctx.stroke()
          ctx.strokeStyle = '#ef4444'
          ctx.lineWidth = 3
          ctx.beginPath(); ctx.moveTo(width * 0.2, barY); ctx.lineTo(width * 0.8, barY); ctx.stroke()
          label(ctx, `Xà: ${highJumpBarHeight(rt.streak).toFixed(2)} m`, width / 2, barY - 14, 13, '#fde047')
          ctx.restore()
        }
        if (rt.phase === 'playing') emoji(ctx, cfg.prop === '🏃' || cfg.prop === '🤸' || cfg.prop === '⛸️' ? '🔻' : cfg.prop, x0 + pos * bw, by - bh * 0.9, Math.min(width * 0.09, 44))
        label(ctx, rt.phase === 'playing' ? 'CHẠM khi vào vùng xanh' : '', width / 2, by + bh * 2.2, 14, 'rgba(255,255,255,0.85)')
      } else {
        const goal = cfg.goal ?? 40
        const seconds = cfg.seconds ?? 10
        const elapsed = Math.max(0, (now - rt.startedAt) / 1000)
        const snap = mashSnapshot(rt.taps, elapsed, goal, seconds, cfg.rival ?? 4)
        const lanes = cfg.lanes ?? ['Bạn', 'Đối thủ']
        const x0 = width * 0.1
        const bw = width * 0.8
        const rows: Array<[string, number, string, string]> = [
          [lanes[0], snap.you, cfg.prop, '#22c55e'],
          [lanes[1], snap.rival, cfg.rivalIcon ?? cfg.prop, '#ef4444'],
        ]
        rows.forEach(([name, value, icon, color], i) => {
          const y = height * (0.34 + i * 0.2)
          label(ctx, name, x0, y - height * 0.07, 14, '#fff', 'left')
          bar(ctx, x0, y, bw, 14, value, color)
          emoji(ctx, icon, x0 + value * bw, y - 14, Math.min(width * 0.1, 46))
        })
        ctx.strokeStyle = '#fde047'
        ctx.lineWidth = 3
        ctx.setLineDash([6, 6])
        ctx.beginPath(); ctx.moveTo(x0 + bw, height * 0.22); ctx.lineTo(x0 + bw, height * 0.62); ctx.stroke()
        ctx.setLineDash([])
        label(ctx, '🏁', x0 + bw, height * 0.2, 18)
        if (rt.phase === 'playing') label(ctx, `Chạm: ${rt.taps} / ${goal}`, width / 2, height * 0.78, 18, '#fde047')
      }

      rt.fx = rt.fx.filter((fx) => now - fx.born < 900)
      for (const fx of rt.fx) {
        const age = (now - fx.born) / 900
        ctx.globalAlpha = 1 - age
        label(ctx, fx.text, fx.x, fx.y - age * 40, 22, fx.color)
        ctx.globalAlpha = 1
      }
    }

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame)
      update(now)
      draw(now)
    }
    raf = requestAnimationFrame(frame)

    return () => {
      cancelAnimationFrame(raf)
      observer.disconnect()
      canvas.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      window.removeEventListener('keydown', onKey)
    }
  }, [cfg, emit, finish, name])

  const counter = cfg.mode === 'mash'
    ? { text: `⏱ ${hud.secondsLeft.toFixed(1)}s` }
    : name === 'high jump'
      ? { text: `Lượt còn: ${hud.left} · Xà: ${highJumpBarHeight(hud.streak).toFixed(2)} m` }
      : { text: `Lượt còn: ${hud.left}` }

  return (
    <div
      className="relative flex h-[min(72svh,36rem)] min-h-[420px] w-full flex-col overflow-hidden rounded-xl border border-border text-white select-none"
      style={{ background: `linear-gradient(180deg, ${cfg.accent}, #020617)` }}
    >
      <video ref={videoRef} playsInline muted autoPlay
        className={`absolute inset-0 size-full object-cover transition-opacity duration-300 ${camera.active ? 'opacity-100' : 'pointer-events-none opacity-0'}`} />
      {camera.active && <div className="absolute inset-0 bg-black/25" aria-hidden="true" />}
      <canvas ref={canvasRef} className="absolute inset-0 size-full touch-none" aria-label={`Trò chơi AR: ${cfg.title}`} role="img" />

      <div className="relative z-10 flex items-center justify-between bg-gradient-to-b from-black/80 via-black/40 to-transparent p-3">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/20 px-3 py-1 font-bold text-emerald-300">
            <Trophy size={16} aria-hidden="true" /><span className="text-sm">Điểm:</span><span className="text-lg tabular-nums">{hud.score}</span>
          </div>
          {hud.streak > 1 && (
            <div className="flex items-center gap-1 rounded-lg border border-amber-500/40 bg-amber-500/20 px-2.5 py-1 text-xs font-semibold text-amber-300 motion-safe:animate-pulse">
              <Sparkles size={14} aria-hidden="true" /><span>Chuỗi: {hud.streak}🔥</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <Button variant="ghost" className="size-8 min-h-0 rounded-full bg-white/10 p-0 text-white hover:bg-white/20" onClick={toggleSound}
            aria-label={soundOn ? 'Tắt âm thanh' : 'Bật âm thanh'}>{soundOn ? <Volume2 size={16} /> : <VolumeX size={16} />}</Button>
          <Button variant="ghost" onClick={camera.toggle} aria-label={camera.active ? 'Tắt camera thực tế' : 'Bật camera thực tế'}
            className={`size-8 min-h-0 rounded-full p-0 ${camera.active ? 'bg-primary text-primary-foreground' : 'bg-white/10 text-white hover:bg-white/20'}`}><Camera size={16} /></Button>
          <Button variant="ghost" className="size-8 min-h-0 rounded-full bg-white/10 p-0 text-white hover:bg-white/20" onClick={start} aria-label="Chơi lại"><RotateCcw size={16} /></Button>
        </div>
      </div>

      {hud.phase === 'playing' && (
        <div className="pointer-events-none absolute inset-x-0 top-14 z-10 flex flex-col items-center gap-1 px-4">
          <div className="rounded-full border border-white/20 bg-black/60 px-3 py-0.5 text-xs font-semibold tabular-nums">{counter.text}</div>
          {hud.message && <div role="status" className="rounded-full border border-white/20 bg-black/75 px-4 py-1.5 text-center text-xs font-medium text-amber-300 shadow-lg">{hud.message}</div>}
        </div>
      )}

      {hud.phase !== 'playing' && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-black/60 p-6 text-center">
          <div className="text-6xl" aria-hidden="true">{hud.phase === 'over' ? (hud.result === 'lose' ? '😤' : '🏆') : cfg.icon}</div>
          <h3 className="text-2xl font-bold">
            {hud.phase === 'ready' ? cfg.title : hud.result === 'win' ? 'Chiến thắng!' : hud.result === 'lose' ? 'Thua rồi, thử lại nhé!' : 'Hết lượt!'}
          </h3>
          {hud.phase === 'over' && <p className="text-lg tabular-nums">Điểm: <b>{hud.score}</b> · Kỷ lục: <b>{hud.best}</b></p>}
          <p className="max-w-xs text-sm text-white/80">{cfg.hint}</p>
          <Button className="mt-2 min-h-12 px-8 text-base font-semibold" onClick={start}>{hud.phase === 'ready' ? 'Bắt đầu' : 'Chơi lại'}</Button>
          {camera.error && <p className="text-[11px] text-rose-300">{camera.error}</p>}
        </div>
      )}
    </div>
  )
}

export function SportGame({ label: sportLabel }: { label: string; onClose?: () => void }) {
  const cfg = getSportGame(sportLabel)
  return cfg ? <GameView key={sportLabel} cfg={cfg} name={sportLabel} /> : null
}
