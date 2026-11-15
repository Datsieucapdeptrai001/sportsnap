import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { Camera, RotateCcw, Volume2, VolumeX, Sparkles, Trophy } from 'lucide-react'
import { soundEngine } from '../../lib/interactive-ar/sound-effects'
import { Button } from '../ui/button'

interface BasketballGameProps {
  onClose?: () => void
}

export function BasketballGame({ }: BasketballGameProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const [score, setScore] = useState(0)
  const [streak, setStreak] = useState(0)
  const [highScore, setHighScore] = useState(0)
  const [feedback, setFeedback] = useState<string | null>('Vuốt lên để ném bóng vào rổ!')
  const [soundEnabled, setSoundEnabled] = useState(true)
  const [cameraActive, setCameraActive] = useState(false)
  const [cameraError, setCameraError] = useState<string | null>(null)

  // Game references
  const stateRef = useRef<{
    score: number
    streak: number
    highScore: number
    soundEnabled: boolean
    isAiming: boolean
    startPos: { x: number; y: number; time: number }
    ballState: 'idle' | 'flying' | 'scored' | 'missed'
    ballVelocity: THREE.Vector3
    ballSpin: THREE.Vector3
    confetti: Array<{ mesh: THREE.Mesh; vel: THREE.Vector3; rot: THREE.Vector3 }>
  }>({
    score: 0,
    streak: 0,
    highScore: 0,
    soundEnabled: true,
    isAiming: false,
    startPos: { x: 0, y: 0, time: 0 },
    ballState: 'idle',
    ballVelocity: new THREE.Vector3(),
    ballSpin: new THREE.Vector3(),
    confetti: [],
  })

  // Keep stateRef synced with React state
  useEffect(() => {
    stateRef.current.score = score
    stateRef.current.streak = streak
    stateRef.current.highScore = highScore
    stateRef.current.soundEnabled = soundEnabled
  }, [score, streak, highScore, soundEnabled])

  // Auto-start Camera AR on mount
  useEffect(() => {
    let mounted = true
    async function startCameraAutomatically() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        })
        if (mounted && videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play()
          setCameraActive(true)
          setCameraError(null)
          setFeedback('📷 Đã mở Camera AR thực tế! Vuốt lên để ném bóng!')
        } else {
          stream.getTracks().forEach((track) => track.stop())
        }
      } catch (err) {
        if (mounted) {
          console.info('[Basketball AR] Camera auto-start skipped/denied, playing in 3D mode:', err)
          setCameraActive(false)
          setCameraError('Chế độ 3D ảo. Bấm biểu tượng Camera để bật camera thực tế.')
        }
      }
    }
    void startCameraAutomatically()
    return () => {
      mounted = false
    }
  }, [])

  // Camera toggle handler
  async function toggleCamera() {
    if (cameraActive) {
      if (videoRef.current && videoRef.current.srcObject) {
        const stream = videoRef.current.srcObject as MediaStream
        stream.getTracks().forEach((track) => track.stop())
        videoRef.current.srcObject = null
      }
      setCameraActive(false)
      setCameraError(null)
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        })
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play()
          setCameraActive(true)
          setCameraError(null)
          setFeedback('📷 Đã mở Camera AR thực tế!')
        }
      } catch {
        setCameraError('Không thể mở camera. Bạn vẫn chơi được ở chế độ 3D.')
        setCameraActive(false)
      }
    }
  }

  // Cleanup camera on unmount
  useEffect(() => {
    return () => {
      if (videoRef.current && videoRef.current.srcObject) {
        const stream = videoRef.current.srcObject as MediaStream
        stream.getTracks().forEach((track) => track.stop())
      }
    }
  }, [])

  // Three.js main game loop and scene setup
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const width = container.clientWidth
    const height = container.clientHeight

    // Scene, Camera, Renderer
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 100)
    camera.position.set(0, 1.45, 3.4)
    camera.lookAt(0, 1.7, -2.4)

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setSize(width, height)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    container.appendChild(renderer.domElement)

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.0)
    scene.add(ambientLight)

    const dirLight = new THREE.DirectionalLight(0xffffff, 1.8)
    dirLight.position.set(3, 8, 5)
    dirLight.castShadow = true
    dirLight.shadow.mapSize.width = 1024
    dirLight.shadow.mapSize.height = 1024
    scene.add(dirLight)

    const rimLight = new THREE.PointLight(0xff9922, 1.2, 5)
    rimLight.position.set(0, 2.3, -2.2)
    scene.add(rimLight)

    // Court Floor (Semi-transparent grid when camera is on, nice wood otherwise)
    const floorGeo = new THREE.PlaneGeometry(12, 16)
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x18202c,
      roughness: 0.6,
      metalness: 0.1,
      transparent: true,
      opacity: cameraActive ? 0.25 : 0.85,
    })
    const floor = new THREE.Mesh(floorGeo, floorMat)
    floor.rotation.x = -Math.PI / 2
    floor.position.y = 0
    floor.receiveShadow = true
    scene.add(floor)

    // Court key lines
    const lineGeo = new THREE.RingGeometry(1.2, 1.26, 32)
    const lineMat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, opacity: 0.4, transparent: true })
    const line = new THREE.Mesh(lineGeo, lineMat)
    line.rotation.x = -Math.PI / 2
    line.position.set(0, 0.01, -0.6)
    scene.add(line)

    // Build Basketball Hoop
    const hoopGroup = new THREE.Group()

    // 1. Backboard
    const backboardGeo = new THREE.BoxGeometry(1.6, 1.0, 0.04)
    const backboardMat = new THREE.MeshStandardMaterial({
      color: 0xf5f7fb,
      roughness: 0.2,
      metalness: 0.1,
      transparent: true,
      opacity: 0.92,
    })
    const backboard = new THREE.Mesh(backboardGeo, backboardMat)
    backboard.position.set(0, 2.45, -2.6)
    backboard.castShadow = true
    backboard.receiveShadow = true
    hoopGroup.add(backboard)

    // Backboard inner target square
    const innerBoxGeo = new THREE.BoxGeometry(0.56, 0.42, 0.042)
    const innerBoxMat = new THREE.MeshBasicMaterial({ color: 0xd9381e, wireframe: true })
    const innerBox = new THREE.Mesh(innerBoxGeo, innerBoxMat)
    innerBox.position.set(0, 2.36, -2.6)
    hoopGroup.add(innerBox)

    // 2. Rim
    const rimRadius = 0.225
    const rimGeo = new THREE.TorusGeometry(rimRadius, 0.016, 16, 32)
    const rimMat = new THREE.MeshStandardMaterial({ color: 0xff4500, roughness: 0.3, metalness: 0.6 })
    const rim = new THREE.Mesh(rimGeo, rimMat)
    rim.rotation.x = Math.PI / 2
    rim.position.set(0, 2.15, -2.28)
    rim.castShadow = true
    hoopGroup.add(rim)

    // 3. Net
    const netPoints = []
    for (let i = 0; i <= 8; i++) {
      const radius = 0.22 - (i / 8) * 0.09
      const y = - (i / 8) * 0.42
      netPoints.push(new THREE.Vector2(radius, y))
    }
    const netGeo = new THREE.LatheGeometry(netPoints, 16)
    const netMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      wireframe: true,
      transparent: true,
      opacity: 0.65,
    })
    const net = new THREE.Mesh(netGeo, netMat)
    net.position.set(0, 2.15, -2.28)
    hoopGroup.add(net)

    // 4. Pole & Arm
    const poleGeo = new THREE.CylinderGeometry(0.06, 0.06, 3.2, 16)
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.7, roughness: 0.3 })
    const pole = new THREE.Mesh(poleGeo, poleMat)
    pole.position.set(0, 1.6, -2.95)
    hoopGroup.add(pole)

    const armGeo = new THREE.BoxGeometry(0.08, 0.08, 0.5)
    const arm = new THREE.Mesh(armGeo, poleMat)
    arm.position.set(0, 2.45, -2.78)
    hoopGroup.add(arm)

    scene.add(hoopGroup)

    // Procedural Basketball Texture
    function createBasketballTexture(): THREE.CanvasTexture {
      const canvas = document.createElement('canvas')
      canvas.width = 512
      canvas.height = 256
      const ctx = canvas.getContext('2d')
      if (ctx) {
        // Base orange leather
        ctx.fillStyle = '#dc5815'
        ctx.fillRect(0, 0, canvas.width, canvas.height)

        // Subtle pebbles
        ctx.fillStyle = '#b7440b'
        for (let i = 0; i < 4000; i++) {
          const x = Math.random() * canvas.width
          const y = Math.random() * canvas.height
          ctx.fillRect(x, y, 2, 2)
        }

        // Black seam lines
        ctx.strokeStyle = '#1a1a1a'
        ctx.lineWidth = 8
        ctx.beginPath()
        // Horizontal line
        ctx.moveTo(0, 128)
        ctx.lineTo(512, 128)
        // Vertical lines
        ctx.moveTo(128, 0)
        ctx.lineTo(128, 256)
        ctx.moveTo(384, 0)
        ctx.lineTo(384, 256)
        // Elliptical curves
        ctx.arc(256, 128, 90, 0, Math.PI * 2)
        ctx.stroke()
      }
      const tex = new THREE.CanvasTexture(canvas)
      tex.wrapS = THREE.RepeatWrapping
      tex.wrapT = THREE.ClampToEdgeWrapping
      return tex
    }

    // Basketball Mesh
    const ballRadius = 0.12
    const ballGeo = new THREE.SphereGeometry(ballRadius, 32, 32)
    const ballMat = new THREE.MeshStandardMaterial({
      map: createBasketballTexture(),
      roughness: 0.55,
      metalness: 0.05,
    })
    const ball = new THREE.Mesh(ballGeo, ballMat)
    ball.castShadow = true
    scene.add(ball)

    // Ball initial rest position
    const idleBallPos = new THREE.Vector3(0, 0.95, 2.1)
    ball.position.copy(idleBallPos)

    // Confetti generator for celebratory goals
    function spawnConfetti(origin: THREE.Vector3) {
      const colors = [0xffd700, 0xff4500, 0x00ff88, 0x00d4ff, 0xff0077, 0xffffff]
      const count = 60
      for (let i = 0; i < count; i++) {
        const cGeo = new THREE.PlaneGeometry(0.04, 0.03)
        const cMat = new THREE.MeshBasicMaterial({
          color: colors[Math.floor(Math.random() * colors.length)],
          side: THREE.DoubleSide,
        })
        const cMesh = new THREE.Mesh(cGeo, cMat)
        cMesh.position.copy(origin)
        scene.add(cMesh)

        const angle = Math.random() * Math.PI * 2
        const speed = 1.2 + Math.random() * 2.5
        const vel = new THREE.Vector3(
          Math.cos(angle) * speed * 0.7,
          Math.random() * 2.2 + 1.2,
          Math.sin(angle) * speed * 0.7,
        )
        const rot = new THREE.Vector3(
          (Math.random() - 0.5) * 15,
          (Math.random() - 0.5) * 15,
          (Math.random() - 0.5) * 15,
        )
        stateRef.current.confetti.push({ mesh: cMesh, vel, rot })
      }
    }

    // Ball reset logic
    let resetTimer: number | null = null
    function scheduleBallReset(delay = 1800) {
      if (resetTimer) window.clearTimeout(resetTimer)
      resetTimer = window.setTimeout(() => {
        ball.position.copy(idleBallPos)
        stateRef.current.ballVelocity.set(0, 0, 0)
        stateRef.current.ballSpin.set(0, 0, 0)
        stateRef.current.ballState = 'idle'
      }, delay)
    }

    // Touch / Pointer Events for Shooting
    function getPointerPos(e: MouseEvent | TouchEvent) {
      if ('touches' in e && e.touches.length > 0) {
        return { x: e.touches[0].clientX, y: e.touches[0].clientY }
      }
      const me = e as MouseEvent
      return { x: me.clientX, y: me.clientY }
    }

    function onPointerDown(e: MouseEvent | TouchEvent) {
      if (stateRef.current.ballState !== 'idle') return
      const pos = getPointerPos(e)
      stateRef.current.isAiming = true
      stateRef.current.startPos = { x: pos.x, y: pos.y, time: performance.now() }
      setFeedback('Thả tay để ném!')
    }

    function onPointerUp(e: MouseEvent | TouchEvent) {
      if (!stateRef.current.isAiming || stateRef.current.ballState !== 'idle') return
      stateRef.current.isAiming = false

      let endX = stateRef.current.startPos.x
      let endY = stateRef.current.startPos.y
      if ('changedTouches' in e && e.changedTouches.length > 0) {
        endX = e.changedTouches[0].clientX
        endY = e.changedTouches[0].clientY
      } else {
        const me = e as MouseEvent
        endX = me.clientX
        endY = me.clientY
      }

      const dx = endX - stateRef.current.startPos.x
      const dy = endY - stateRef.current.startPos.y
      const dt = Math.max(performance.now() - stateRef.current.startPos.time, 40)

      // Only shoot if upward swipe
      if (dy < -20) {
        const swipeSpeedY = Math.abs(dy) / dt // px/ms
        const swipeSpeedX = dx / dt

        // Map swipe speed into physical 3D launch velocity
        const forwardVel = -Math.min(Math.max(swipeSpeedY * 3.6, 4.0), 6.5)
        const upwardVel = Math.min(Math.max(swipeSpeedY * 3.1, 4.2), 6.8)
        const lateralVel = Math.min(Math.max(swipeSpeedX * 2.2, -2.5), 2.5)

        stateRef.current.ballVelocity.set(lateralVel, upwardVel, forwardVel)
        stateRef.current.ballSpin.set(-8, 0, (Math.random() - 0.5) * 4) // realistic backspin
        stateRef.current.ballState = 'flying'

        if (stateRef.current.soundEnabled) soundEngine.playBounce()
        soundEngine.triggerHaptic('light')
        setFeedback(null)
      } else {
        setFeedback('Vuốt thẳng lên trên để ném bóng!')
      }
    }

    container.addEventListener('mousedown', onPointerDown)
    window.addEventListener('mouseup', onPointerUp)
    container.addEventListener('touchstart', onPointerDown, { passive: true })
    window.addEventListener('touchend', onPointerUp, { passive: true })

    // Animation & Physics Loop
    let animId: number
    let lastTime = performance.now()
    const gravity = -9.8
    const rimPos = rim.position
    const backboardZ = backboard.position.z + 0.03

    function animate() {
      animId = requestAnimationFrame(animate)
      const now = performance.now()
      const dt = Math.min((now - lastTime) / 1000, 0.05)
      lastTime = now

      // Idle ball floating animation
      if (stateRef.current.ballState === 'idle') {
        ball.position.y = idleBallPos.y + Math.sin(now * 0.004) * 0.03
        ball.rotation.y += 0.015
      }

      // Flying Physics
      if (stateRef.current.ballState === 'flying' || stateRef.current.ballState === 'scored' || stateRef.current.ballState === 'missed') {
        const vel = stateRef.current.ballVelocity
        const spin = stateRef.current.ballSpin

        // Apply gravity
        vel.y += gravity * dt

        // Update position
        ball.position.addScaledVector(vel, dt)
        ball.rotation.x += spin.x * dt
        ball.rotation.y += spin.y * dt
        ball.rotation.z += spin.z * dt

        // 1. Backboard collision
        if (
          ball.position.z <= backboardZ + ballRadius &&
          ball.position.z >= backboardZ - 0.1 &&
          Math.abs(ball.position.x) <= 0.8 &&
          ball.position.y >= 1.95 &&
          ball.position.y <= 2.95 &&
          vel.z < 0
        ) {
          vel.z = -vel.z * 0.65 // bounce forward
          vel.y *= 0.8
          vel.x += (Math.random() - 0.5) * 0.4
          if (stateRef.current.soundEnabled) soundEngine.playBounce()
          soundEngine.triggerHaptic('medium')
        }

        // 2. Goal / Rim Check
        const distToRimCenter = Math.hypot(ball.position.x - rimPos.x, ball.position.z - rimPos.z)
        const verticalDist = ball.position.y - rimPos.y

        // Check if ball passed downward through the rim (SWISH / GOAL)
        if (
          stateRef.current.ballState === 'flying' &&
          distToRimCenter <= rimRadius * 0.82 &&
          verticalDist <= 0.06 &&
          verticalDist >= -0.15 &&
          vel.y < 0
        ) {
          stateRef.current.ballState = 'scored'
          vel.y *= 0.4 // net drag slowing down ball
          vel.x *= 0.5
          vel.z *= 0.5

          // Score and Streak
          const newScore = stateRef.current.score + 2
          const newStreak = stateRef.current.streak + 1
          setScore(newScore)
          setStreak(newStreak)
          if (newScore > stateRef.current.highScore) {
            setHighScore(newScore)
          }

          setFeedback(`VÀO RỔ! +2 ĐIỂM 🎉 (${newStreak > 1 ? `Chuỗi: ${newStreak} quả!` : 'Cú ném đẹp mắt!'})`)

          if (stateRef.current.soundEnabled) {
            soundEngine.playSwish()
            soundEngine.playCheer()
          }
          soundEngine.triggerHaptic('success')
          spawnConfetti(rimPos)
          scheduleBallReset(2200)
        }
        // 3. Rim edge collision
        else if (
          Math.abs(distToRimCenter - rimRadius) < 0.08 &&
          Math.abs(verticalDist) < 0.09
        ) {
          vel.y = Math.abs(vel.y) * 0.55 // bounce up
          const normalX = (ball.position.x - rimPos.x) / (distToRimCenter || 1)
          const normalZ = (ball.position.z - rimPos.z) / (distToRimCenter || 1)
          vel.x += normalX * 1.5
          vel.z += normalZ * 1.5
          if (stateRef.current.soundEnabled) soundEngine.playRimHit()
          soundEngine.triggerHaptic('light')
        }

        // 4. Floor bounce / Out of bounds
        if (ball.position.y <= ballRadius) {
          ball.position.y = ballRadius
          if (Math.abs(vel.y) > 0.8) {
            vel.y = -vel.y * 0.55
            vel.x *= 0.7
            vel.z *= 0.7
            if (stateRef.current.soundEnabled) soundEngine.playBounce()
          } else {
            vel.set(0, 0, 0)
          }
          if (stateRef.current.ballState === 'flying') {
            stateRef.current.ballState = 'missed'
            setStreak(0)
            setFeedback('Trượt rồi! Đừng nản, thử lại nào!')
            scheduleBallReset(1500)
          }
        }
      }

      // Update Confetti
      for (let i = stateRef.current.confetti.length - 1; i >= 0; i--) {
        const p = stateRef.current.confetti[i]
        p.vel.y += gravity * 0.3 * dt
        p.mesh.position.addScaledVector(p.vel, dt)
        p.mesh.rotation.x += p.rot.x * dt
        p.mesh.rotation.y += p.rot.y * dt
        p.mesh.rotation.z += p.rot.z * dt
        if (p.mesh.position.y < 0) {
          scene.remove(p.mesh)
          stateRef.current.confetti.splice(i, 1)
        }
      }

      renderer.render(scene, camera)
    }

    animate()

    // Resize handling
    const onResize = () => {
      if (!container) return
      const w = container.clientWidth
      const h = container.clientHeight
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.setSize(w, h)
    }
    window.addEventListener('resize', onResize)

    return () => {
      cancelAnimationFrame(animId)
      window.removeEventListener('resize', onResize)
      container.removeEventListener('mousedown', onPointerDown)
      window.removeEventListener('mouseup', onPointerUp)
      container.removeEventListener('touchstart', onPointerDown)
      window.removeEventListener('touchend', onPointerUp)
      if (resetTimer) window.clearTimeout(resetTimer)
      renderer.dispose()
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement)
      }
    }
  }, [cameraActive])

  function resetGame() {
    setScore(0)
    setStreak(0)
    setFeedback('Đã đặt lại điểm số! Vuốt để ném.')
  }

  return (
    <div className="relative flex h-[min(72svh,36rem)] min-h-[420px] w-full flex-col overflow-hidden rounded-xl border border-border bg-slate-950 text-white select-none">
      {/* Background Live Camera Video */}
      <video
        ref={videoRef}
        playsInline
        muted
        autoPlay
        className={`absolute inset-0 size-full object-cover transition-opacity duration-300 ${cameraActive ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
      />

      {/* Camera Live Indicator */}
      {cameraActive && (
        <div className="pointer-events-none absolute top-14 left-3 z-10 flex items-center gap-1.5 rounded-full bg-emerald-500/90 backdrop-blur-sm px-2.5 py-0.5 text-[11px] font-semibold text-white shadow-lg animate-in fade-in">
          <span className="size-2 rounded-full bg-white animate-pulse" />
          <span>Camera AR Phòng Thật</span>
        </div>
      )}

      {/* 3D WebGL Canvas Container */}
      <div ref={containerRef} className="absolute inset-0 size-full cursor-grab active:cursor-grabbing touch-none" />

      {/* Top HUD: Score & Controls */}
      <div className="relative z-10 flex items-center justify-between p-3 bg-gradient-to-b from-black/80 via-black/40 to-transparent">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 rounded-lg bg-emerald-500/20 border border-emerald-500/40 px-3 py-1 font-bold text-emerald-400">
            <Trophy size={16} />
            <span className="text-sm">Điểm:</span>
            <span className="text-lg tabular-nums">{score}</span>
          </div>

          {streak > 1 && (
            <div className="flex items-center gap-1 rounded-lg bg-amber-500/20 border border-amber-500/40 px-2.5 py-1 text-xs font-semibold text-amber-300 motion-safe:animate-pulse">
              <Sparkles size={14} />
              <span>Chuỗi: {streak}🔥</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          {/* Sound Toggle */}
          <Button
            variant="ghost"
            className="size-8 p-0 rounded-full bg-white/10 hover:bg-white/20 text-white min-h-0"
            onClick={() => setSoundEnabled(!soundEnabled)}
            aria-label={soundEnabled ? 'Tắt âm thanh' : 'Bật âm thanh'}
          >
            {soundEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
          </Button>

          {/* Camera AR Toggle */}
          <Button
            variant="ghost"
            className={`size-8 p-0 rounded-full min-h-0 transition-colors ${cameraActive ? 'bg-primary text-primary-foreground' : 'bg-white/10 hover:bg-white/20 text-white'}`}
            onClick={toggleCamera}
            aria-label={cameraActive ? 'Tắt camera thực tế' : 'Bật camera thực tế'}
            title="Bật/Tắt Camera AR thực tế"
          >
            <Camera size={16} />
          </Button>

          {/* Reset Score */}
          <Button
            variant="ghost"
            className="size-8 p-0 rounded-full bg-white/10 hover:bg-white/20 text-white min-h-0"
            onClick={resetGame}
            aria-label="Chơi lại"
            title="Đặt lại điểm số"
          >
            <RotateCcw size={16} />
          </Button>
        </div>
      </div>

      {/* Center Feedback Banner */}
      {feedback && (
        <div className="pointer-events-none absolute top-14 inset-x-0 z-10 flex justify-center px-4">
          <div className="rounded-full bg-black/75 backdrop-blur-md border border-white/20 px-4 py-1.5 text-xs font-medium text-amber-300 shadow-lg text-center animate-in fade-in slide-in-from-top-2">
            {feedback}
          </div>
        </div>
      )}

      {/* Bottom Hint */}
      <div className="pointer-events-none absolute bottom-3 inset-x-0 z-10 flex flex-col items-center justify-center text-center">
        <div className="flex items-center gap-1.5 rounded-full bg-black/60 px-3 py-1 text-[11px] text-white/80 backdrop-blur-sm">
          <span>👆 Vuốt từ quả bóng thẳng lên rổ để ném</span>
        </div>
        {cameraError && (
          <p className="mt-1 text-[10px] text-rose-300">{cameraError}</p>
        )}
      </div>
    </div>
  )
}
