import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { Camera, RotateCcw, Sparkles, SwitchCamera, Trophy, Volume2, VolumeX, X } from 'lucide-react'
import {
  SOCCER_GOAL_HALF_W,
  SOCCER_GOAL_HEIGHT,
  SOCCER_GOAL_Z,
  SOCCER_GRAVITY,
  SOCCER_START,
  calculateSoccerVelocity,
  isSoccerInGoal,
  soccerKeeperWorldX,
} from '../../lib/interactive-ar/games'
import { soundEngine } from '../../lib/interactive-ar/sound-effects'
import { Button } from '../ui/button'
import { useCameraBackground } from './use-camera-background'

export interface SoccerGameProps {
  onClose?: () => void
}

const BEST_KEY = 'sportsnap.ar-best.soccer'

function readSoccerBest(): number {
  try {
    const value = Number(globalThis.localStorage?.getItem(BEST_KEY))
    return Number.isFinite(value) && value > 0 ? value : 0
  } catch {
    return 0
  }
}

function writeSoccerBest(value: number): void {
  try {
    globalThis.localStorage?.setItem(BEST_KEY, String(value))
  } catch {
    // Ignore storage errors in restricted contexts
  }
}

function createSoccerBallTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 256
  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.fillStyle = '#f8fafc'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.strokeStyle = '#cbd5e1'
    ctx.lineWidth = 3
    // Draw stylized pentagon patches across equirectangular map
    const centers = [
      [64, 64], [192, 64], [320, 64], [448, 64],
      [128, 128], [256, 128], [384, 128],
      [64, 192], [192, 192], [320, 192], [448, 192],
    ]
    ctx.fillStyle = '#0f172a'
    for (const [cx, cy] of centers) {
      ctx.beginPath()
      for (let i = 0; i < 5; i += 1) {
        const a = (i * Math.PI * 2) / 5 - Math.PI / 2
        const x = cx + Math.cos(a) * 26
        const y = cy + Math.sin(a) * 24
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.closePath()
      ctx.fill()
      ctx.stroke()
    }
  }
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

function createNetTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 256
  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.clearRect(0, 0, 256, 256)
    ctx.strokeStyle = 'rgba(255,255,255,0.75)'
    ctx.lineWidth = 3
    const step = 24
    for (let x = 0; x <= 256; x += step) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 256); ctx.stroke()
    }
    for (let y = 0; y <= 256; y += step) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(256, y); ctx.stroke()
    }
  }
  const tex = new THREE.CanvasTexture(canvas)
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(3, 2)
  return tex
}

function disposeScene(scene: THREE.Scene): void {
  scene.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.geometry?.dispose()
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material]
      for (const m of mats) {
        if ('map' in m && m.map instanceof THREE.Texture) m.map.dispose()
        m.dispose()
      }
    }
  })
}

export function SoccerGame({ onClose }: SoccerGameProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const pitchMatRef = useRef<THREE.MeshStandardMaterial | null>(null)
  const camera = useCameraBackground(videoRef)

  const [score, setScore] = useState(0)
  const [streak, setStreak] = useState(0)
  const [highScore, setHighScore] = useState(readSoccerBest)
  const [feedback, setFeedback] = useState<string>('Vuốt lên để sút phạt đền 3D!')
  const [soundEnabled, setSoundEnabled] = useState(true)

  const stateRef = useRef({
    score: 0,
    streak: 0,
    highScore: readSoccerBest(),
    soundEnabled: true,
    isAiming: false,
    startPos: { x: 0, y: 0, time: 0 },
    aimPos: { x: 0, y: 0 },
    ballState: 'idle' as 'idle' | 'flying' | 'scored' | 'saved' | 'missed',
    vel: new THREE.Vector3(),
    spinY: 0,
    resetAt: 0,
    netShake: 0,
    keeperSpeed: 1.45,
    confetti: [] as Array<{ mesh: THREE.Mesh; vel: THREE.Vector3; rot: THREE.Vector3 }>,
  })

  useEffect(() => {
    stateRef.current.score = score
    stateRef.current.streak = streak
    stateRef.current.highScore = highScore
    stateRef.current.soundEnabled = soundEnabled
  }, [score, streak, highScore, soundEnabled])

  useEffect(() => {
    if (pitchMatRef.current) {
      pitchMatRef.current.opacity = camera.active ? 0.24 : 0.92
      pitchMatRef.current.needsUpdate = true
    }
  }, [camera.active])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const state = stateRef.current

    const width = Math.max(container.clientWidth, 1)
    const height = Math.max(container.clientHeight, 1)

    const scene = new THREE.Scene()
    const threeCam = new THREE.PerspectiveCamera(48, width / height, 0.1, 100)
    threeCam.position.set(0, 1.35, 5.4)
    threeCam.lookAt(0, 0.85, SOCCER_GOAL_Z)

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setSize(width, height)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    container.appendChild(renderer.domElement)

    scene.add(new THREE.AmbientLight(0xffffff, 1.05))
    const sun = new THREE.DirectionalLight(0xffffff, 1.8)
    sun.position.set(4, 9, 5)
    sun.castShadow = true
    sun.shadow.mapSize.set(1024, 1024)
    scene.add(sun)

    // Pitch plane + penalty lines
    const pitchMat = new THREE.MeshStandardMaterial({
      color: 0x15803d,
      roughness: 0.9,
      transparent: true,
      opacity: camera.active ? 0.24 : 0.92,
    })
    pitchMatRef.current = pitchMat
    const pitch = new THREE.Mesh(new THREE.PlaneGeometry(14, 14), pitchMat)
    pitch.rotation.x = -Math.PI / 2
    pitch.receiveShadow = true
    scene.add(pitch)

    const lineMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 })
    const goalLine = new THREE.Mesh(new THREE.PlaneGeometry(7.2, 0.06), lineMat)
    goalLine.rotation.x = -Math.PI / 2
    goalLine.position.set(0, 0.005, SOCCER_GOAL_Z)
    scene.add(goalLine)

    const penSpot = new THREE.Mesh(new THREE.CircleGeometry(0.1, 20), lineMat)
    penSpot.rotation.x = -Math.PI / 2
    penSpot.position.set(SOCCER_START.x, 0.006, SOCCER_START.z)
    scene.add(penSpot)

    // 3D Goal frame + Net
    const postMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.3, metalness: 0.2 })
    const postGeo = new THREE.CylinderGeometry(0.055, 0.055, SOCCER_GOAL_HEIGHT, 16)
    const leftPost = new THREE.Mesh(postGeo, postMat)
    leftPost.position.set(-SOCCER_GOAL_HALF_W, SOCCER_GOAL_HEIGHT / 2, SOCCER_GOAL_Z)
    leftPost.castShadow = true
    scene.add(leftPost)

    const rightPost = new THREE.Mesh(postGeo, postMat)
    rightPost.position.set(SOCCER_GOAL_HALF_W, SOCCER_GOAL_HEIGHT / 2, SOCCER_GOAL_Z)
    rightPost.castShadow = true
    scene.add(rightPost)

    const crossbar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.055, 0.055, SOCCER_GOAL_HALF_W * 2 + 0.11, 16),
      postMat,
    )
    crossbar.rotation.z = Math.PI / 2
    crossbar.position.set(0, SOCCER_GOAL_HEIGHT, SOCCER_GOAL_Z)
    crossbar.castShadow = true
    scene.add(crossbar)

    const netTex = createNetTexture()
    const netMat = new THREE.MeshBasicMaterial({
      map: netTex,
      transparent: true,
      opacity: 0.72,
      side: THREE.DoubleSide,
    })
    const backNet = new THREE.Mesh(new THREE.PlaneGeometry(SOCCER_GOAL_HALF_W * 2, SOCCER_GOAL_HEIGHT), netMat)
    backNet.position.set(0, SOCCER_GOAL_HEIGHT / 2, SOCCER_GOAL_Z - 0.95)
    scene.add(backNet)

    const topNet = new THREE.Mesh(new THREE.PlaneGeometry(SOCCER_GOAL_HALF_W * 2, 0.95), netMat)
    topNet.rotation.x = Math.PI / 2
    topNet.position.set(0, SOCCER_GOAL_HEIGHT, SOCCER_GOAL_Z - 0.475)
    scene.add(topNet)

    const sideNetGeo = new THREE.PlaneGeometry(0.95, SOCCER_GOAL_HEIGHT)
    const leftNet = new THREE.Mesh(sideNetGeo, netMat)
    leftNet.rotation.y = Math.PI / 2
    leftNet.position.set(-SOCCER_GOAL_HALF_W, SOCCER_GOAL_HEIGHT / 2, SOCCER_GOAL_Z - 0.475)
    scene.add(leftNet)

    const rightNet = new THREE.Mesh(sideNetGeo, netMat)
    rightNet.rotation.y = -Math.PI / 2
    rightNet.position.set(SOCCER_GOAL_HALF_W, SOCCER_GOAL_HEIGHT / 2, SOCCER_GOAL_Z - 0.475)
    scene.add(rightNet)

    // Animated 3D Goalkeeper group
    const keeperGroup = new THREE.Group()
    keeperGroup.position.set(0, 0, SOCCER_GOAL_Z + 0.18)
    const jerseyMat = new THREE.MeshStandardMaterial({ color: 0xfacc15, roughness: 0.45 })
    const shortsMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.6 })
    const skinMat = new THREE.MeshStandardMaterial({ color: 0xfdba74, roughness: 0.6 })
    const gloveMat = new THREE.MeshStandardMaterial({ color: 0x10b981, roughness: 0.35 })

    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.18, 0.34, 8, 14), jerseyMat)
    torso.position.y = 0.72
    torso.castShadow = true
    keeperGroup.add(torso)

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 16), skinMat)
    head.position.y = 1.12
    keeperGroup.add(head)

    const legs = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.42, 0.16), shortsMat)
    legs.position.y = 0.26
    keeperGroup.add(legs)

    const leftArm = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.34, 6, 10), jerseyMat)
    leftArm.position.set(-0.28, 0.82, 0)
    leftArm.rotation.z = 0.65
    keeperGroup.add(leftArm)

    const rightArm = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.34, 6, 10), jerseyMat)
    rightArm.position.set(0.28, 0.82, 0)
    rightArm.rotation.z = -0.65
    keeperGroup.add(rightArm)

    const leftGlove = new THREE.Mesh(new THREE.SphereGeometry(0.085, 12, 12), gloveMat)
    leftGlove.position.set(-0.42, 0.94, 0.05)
    keeperGroup.add(leftGlove)

    const rightGlove = new THREE.Mesh(new THREE.SphereGeometry(0.085, 12, 12), gloveMat)
    rightGlove.position.set(0.42, 0.94, 0.05)
    keeperGroup.add(rightGlove)

    scene.add(keeperGroup)

    // 3D Soccer Ball
    const ballTex = createSoccerBallTexture()
    const ball = new THREE.Mesh(
      new THREE.SphereGeometry(0.2, 28, 28),
      new THREE.MeshStandardMaterial({ map: ballTex, roughness: 0.35, metalness: 0.05 }),
    )
    ball.position.set(SOCCER_START.x, SOCCER_START.y, SOCCER_START.z)
    ball.castShadow = true
    scene.add(ball)

    // Aim arrow indicator on pitch
    const arrowMat = new THREE.MeshBasicMaterial({ color: 0x34d399, transparent: true, opacity: 0.0 })
    const aimArrow = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.5, 12), arrowMat)
    aimArrow.rotation.x = -Math.PI / 2
    aimArrow.position.set(0, 0.05, SOCCER_START.z - 0.7)
    scene.add(aimArrow)

    const spawnConfetti = (origin: THREE.Vector3) => {
      const colors = [0x34d399, 0xfde047, 0x38bdf8, 0xf43f5e, 0xffffff]
      for (let i = 0; i < 32; i += 1) {
        const mesh = new THREE.Mesh(
          new THREE.PlaneGeometry(0.12, 0.08),
          new THREE.MeshBasicMaterial({ color: colors[i % colors.length], side: THREE.DoubleSide }),
        )
        mesh.position.copy(origin)
        scene.add(mesh)
        state.confetti.push({
          mesh,
          vel: new THREE.Vector3((Math.random() - 0.5) * 4.5, 2 + Math.random() * 3.5, (Math.random() - 0.5) * 3.5),
          rot: new THREE.Vector3(Math.random() * 8, Math.random() * 8, Math.random() * 8),
        })
      }
    }

    const resetBall = () => {
      state.ballState = 'idle'
      state.vel.set(0, 0, 0)
      state.spinY = 0
      ball.position.set(SOCCER_START.x, SOCCER_START.y, SOCCER_START.z)
      ball.rotation.set(0, 0, 0)
    }

    const onDown = (e: PointerEvent) => {
      if (state.ballState !== 'idle') return
      state.isAiming = true
      state.startPos = { x: e.clientX, y: e.clientY, time: performance.now() }
      state.aimPos = { x: e.clientX, y: e.clientY }
    }

    const onMove = (e: PointerEvent) => {
      if (!state.isAiming) return
      state.aimPos = { x: e.clientX, y: e.clientY }
      const dx = e.clientX - state.startPos.x
      const dy = e.clientY - state.startPos.y
      if (dy < -18) {
        const lean = Math.max(-1, Math.min(1, dx / Math.abs(dy)))
        arrowMat.opacity = 0.85
        aimArrow.position.set(lean * 0.55, 0.05, SOCCER_START.z - 0.85)
        aimArrow.rotation.z = -lean * 0.65
      } else {
        arrowMat.opacity = 0
      }
    }

    const onUp = (e: PointerEvent) => {
      if (!state.isAiming) return
      state.isAiming = false
      arrowMat.opacity = 0
      if (state.ballState !== 'idle') return
      const dx = e.clientX - state.startPos.x
      const dy = e.clientY - state.startPos.y
      const dt = performance.now() - state.startPos.time
      const shot = calculateSoccerVelocity(dx, dy, dt)
      if (!shot) {
        setFeedback('Vuốt thẳng lên trên để sút bóng!')
        return
      }
      state.ballState = 'flying'
      state.vel.set(shot.vx, shot.vy, shot.vz)
      state.spinY = shot.spinY
      state.resetAt = performance.now() + 2200
      soundEngine.triggerHaptic('light')
      if (state.soundEnabled) soundEngine.playBounce()
      setFeedback('Bóng đang bay…')
    }

    const dom = renderer.domElement
    dom.addEventListener('pointerdown', onDown)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)

    const onResize = () => {
      const w = Math.max(container.clientWidth, 1)
      const h = Math.max(container.clientHeight, 1)
      threeCam.aspect = w / h
      threeCam.updateProjectionMatrix()
      renderer.setSize(w, h)
    }
    const resizeObs = new ResizeObserver(onResize)
    resizeObs.observe(container)

    let raf = 0
    let prev = performance.now()

    const animate = (now: number) => {
      raf = requestAnimationFrame(animate)
      const dt = Math.min((now - prev) / 1000, 0.05)
      prev = now

      // Move goalkeeper faster as streak rises
      const tSec = now / 1000
      const speed = 1.45 + Math.min(state.streak, 6) * 0.16
      const kx = soccerKeeperWorldX(tSec, speed)
      keeperGroup.position.x = kx
      keeperGroup.rotation.z = -Math.cos(tSec * speed) * 0.14

      if (state.netShake > 0) {
        state.netShake = Math.max(0, state.netShake - dt * 3)
        backNet.position.z = SOCCER_GOAL_Z - 0.95 - Math.sin(now * 0.04) * 0.14 * state.netShake
      } else {
        backNet.position.z = SOCCER_GOAL_Z - 0.95
      }

      if (state.ballState === 'flying') {
        state.vel.y += SOCCER_GRAVITY * dt
        state.vel.x += state.spinY * 0.14 * dt
        ball.position.addScaledVector(state.vel, dt)
        ball.rotation.x -= dt * 11
        ball.rotation.y += state.spinY * dt * 1.4

        // Floor bounce
        if (ball.position.y < 0.2) {
          ball.position.y = 0.2
          state.vel.y = Math.abs(state.vel.y) * 0.45
        }

        // Check goalkeeper block near goal plane
        if (
          ball.position.z <= SOCCER_GOAL_Z + 0.32 &&
          ball.position.z >= SOCCER_GOAL_Z - 0.2 &&
          Math.abs(ball.position.x - keeperGroup.position.x) <= 0.44 &&
          ball.position.y <= 1.28
        ) {
          state.ballState = 'saved'
          state.vel.z = Math.abs(state.vel.z) * 0.35
          state.vel.x += (ball.position.x - keeperGroup.position.x) * 3
          state.resetAt = now + 1150
          setStreak(0)
          setFeedback('🧤 Thủ môn cản phá xuất sắc! Thử góc khác nhé.')
          soundEngine.triggerHaptic('medium')
          if (state.soundEnabled) soundEngine.playBounce()
        } else if (ball.position.z <= SOCCER_GOAL_Z) {
          if (isSoccerInGoal(ball.position)) {
            state.ballState = 'scored'
            state.netShake = 1
            state.vel.multiplyScalar(0.25)
            state.resetAt = now + 1350
            const nextStreak = state.streak + 1
            const pts = nextStreak >= 3 ? 3 : 2
            const nextScore = state.score + pts
            setStreak(nextStreak)
            setScore(nextScore)
            if (nextScore > state.highScore) {
              setHighScore(nextScore)
              writeSoccerBest(nextScore)
            }
            setFeedback(nextStreak >= 3 ? `⚽ VÀO RỒI! Chuỗi ${nextStreak} (+${pts}) 🔥` : `⚽ VÀO LƯỚI! (+${pts} điểm)`)
            spawnConfetti(new THREE.Vector3(ball.position.x, Math.max(0.6, ball.position.y), SOCCER_GOAL_Z))
            soundEngine.triggerHaptic('success')
            if (state.soundEnabled) {
              soundEngine.playSwish()
              soundEngine.playCheer()
            }
          } else {
            state.ballState = 'missed'
            state.resetAt = now + 1150
            setStreak(0)
            setFeedback('Trượt khung thành! Vuốt nhẹ hơn hoặc căn lại hướng.')
            soundEngine.triggerHaptic('medium')
            if (state.soundEnabled) soundEngine.playBounce()
          }
        }
      } else if (state.ballState !== 'idle') {
        ball.position.addScaledVector(state.vel, dt)
        state.vel.multiplyScalar(0.92)
        if (ball.position.y > 0.2) {
          state.vel.y += SOCCER_GRAVITY * dt
          ball.position.y = Math.max(0.2, ball.position.y)
        }
        if (now >= state.resetAt) {
          resetBall()
        }
      } else {
        // Gentle idle bob
        ball.rotation.y += dt * 0.8
      }

      // Update confetti
      for (let i = state.confetti.length - 1; i >= 0; i -= 1) {
        const c = state.confetti[i]
        c.vel.y += SOCCER_GRAVITY * 0.45 * dt
        c.mesh.position.addScaledVector(c.vel, dt)
        c.mesh.rotation.x += c.rot.x * dt
        c.mesh.rotation.y += c.rot.y * dt
        if (c.mesh.position.y < -0.5) {
          scene.remove(c.mesh)
          c.mesh.geometry.dispose()
          ;(c.mesh.material as THREE.Material).dispose()
          state.confetti.splice(i, 1)
        }
      }

      renderer.render(scene, threeCam)
    }
    raf = requestAnimationFrame(animate)

    return () => {
      cancelAnimationFrame(raf)
      resizeObs.disconnect()
      dom.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      disposeScene(scene)
      renderer.dispose()
      dom.remove()
    }
  }, [camera.active])

  function resetMatch() {
    setScore(0)
    setStreak(0)
    setFeedback('Vuốt lên để sút phạt đền 3D!')
  }

  return (
    <div className="relative flex h-[min(72svh,36rem)] min-h-[420px] w-full flex-col overflow-hidden rounded-xl border border-border bg-gradient-to-b from-emerald-950 via-slate-950 to-slate-950 text-white select-none">
      <video
        ref={videoRef}
        playsInline
        muted
        autoPlay
        className={`absolute inset-0 size-full object-cover transition-opacity duration-300 ${camera.active ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
      />
      {camera.active && <div className="pointer-events-none absolute inset-0 bg-black/20" aria-hidden="true" />}
      <div ref={containerRef} className="absolute inset-0 size-full touch-none" aria-label="Trò chơi 3D Sút phạt đền AR" />

      <div className="relative z-10 flex items-center justify-between gap-2 bg-gradient-to-b from-black/80 via-black/40 to-transparent p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/20 px-3 py-1 font-bold text-emerald-300">
            <Trophy size={15} aria-hidden="true" />
            <span className="text-xs sm:text-sm">Điểm:</span>
            <span className="text-base tabular-nums sm:text-lg">{score}</span>
          </div>
          {highScore > 0 && (
            <div className="rounded-lg border border-white/20 bg-black/50 px-2.5 py-1 text-xs text-white/85 tabular-nums">
              Kỷ lục: {highScore}
            </div>
          )}
          {streak > 1 && (
            <div className="flex items-center gap-1 rounded-lg border border-amber-500/40 bg-amber-500/20 px-2.5 py-1 text-xs font-semibold text-amber-300 motion-safe:animate-pulse">
              <Sparkles size={13} aria-hidden="true" />Chuỗi: {streak}🔥
            </div>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <Button variant="ghost" className="size-8 min-h-0 rounded-full bg-white/10 p-0 text-white hover:bg-white/20"
            onClick={() => setSoundEnabled((v) => !v)} aria-label={soundEnabled ? 'Tắt âm thanh' : 'Bật âm thanh'}>
            {soundEnabled ? <Volume2 size={15} /> : <VolumeX size={15} />}
          </Button>
          <Button variant="ghost" onClick={camera.toggle} aria-label={camera.active ? 'Tắt camera thực tế' : 'Bật camera thực tế'}
            className={`size-8 min-h-0 rounded-full p-0 ${camera.active ? 'bg-primary text-primary-foreground' : 'bg-white/10 text-white hover:bg-white/20'}`}>
            <Camera size={15} />
          </Button>
          {camera.active && (
            <Button variant="ghost" onClick={camera.flip} aria-label="Đổi camera trước/sau"
              className="size-8 min-h-0 rounded-full bg-white/10 p-0 text-white hover:bg-white/20">
              <SwitchCamera size={15} />
            </Button>
          )}
          <Button variant="ghost" className="size-8 min-h-0 rounded-full bg-white/10 p-0 text-white hover:bg-white/20"
            onClick={resetMatch} aria-label="Chơi lại">
            <RotateCcw size={15} />
          </Button>
          {onClose && (
            <Button variant="ghost" className="size-8 min-h-0 rounded-full bg-white/10 p-0 text-white hover:bg-white/20"
              onClick={onClose} aria-label="Đóng trò chơi">
              <X size={15} />
            </Button>
          )}
        </div>
      </div>

      <div className="pointer-events-none relative z-10 mt-1 flex flex-col items-center px-4">
        <div role="status" className="rounded-full border border-white/20 bg-black/70 px-4 py-1.5 text-center text-xs font-medium text-emerald-300 shadow-lg backdrop-blur">
          {feedback}
        </div>
        {camera.error && <p className="mt-1 text-[11px] text-rose-300">{camera.error}</p>}
      </div>

      <div className="pointer-events-none relative z-10 mt-auto pb-3 text-center text-xs text-white/75 drop-shadow">
        ⬆ Vuốt lên & sang trái/phải để sút xoáy đánh lừa thủ môn
      </div>
    </div>
  )
}
