import { useEffect, useId, useRef, useState } from 'react'
import type { ModelViewerElement } from '@google/model-viewer'
import { Box, RotateCcw } from 'lucide-react'
import { modelSource, type ArAsset, type CameraArLaunchState } from '../lib/ar'
import { loadViewer } from '../lib/model-viewer'
import { sportNameVi } from '../lib/sport-names'
import { Button } from './ui/button'

type LoadPhase = 'library' | 'model' | 'ready' | 'error'
let retrySequence = 0

export function CameraArOverlay({ label, confidence, asset, cameraReady, launch, onActivateAr, onArStatus, onRescan }: {
  label: string; confidence: number; asset: ArAsset; onRescan: () => void
  cameraReady: boolean
  launch: CameraArLaunchState
  onActivateAr: (activate: () => Promise<void>) => void
  onArStatus: (status: string | undefined) => void
}) {
  const viewerRef = useRef<ModelViewerElement>(null)
  const statusCallbackRef = useRef(onArStatus)
  const [attempt, setAttempt] = useState(0)
  const [phase, setPhase] = useState<LoadPhase>('library')
  const [supported, setSupported] = useState(false)
  const noteId = useId()
  const name = sportNameVi(label)
  const viewerActive = phase === 'model' || phase === 'ready'

  useEffect(() => { statusCallbackRef.current = onArStatus }, [onArStatus])

  useEffect(() => {
    let cancelled = false
    const timeout = window.setTimeout(() => {
      cancelled = true
      setPhase('error')
    }, 60_000)
    loadViewer().then(() => {
      if (!cancelled) setPhase('model')
    }).catch(() => {
      if (!cancelled) setPhase('error')
    }).finally(() => window.clearTimeout(timeout))
    return () => { cancelled = true; window.clearTimeout(timeout) }
  }, [attempt])

  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewerActive || !viewer) return
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const rotate = () => { viewer.autoRotate = !document.hidden && !motion.matches }
    const updateSupport = () => setSupported(window.isSecureContext && viewer.canActivateAR)
    const onLoad = () => { window.clearTimeout(timeout); setPhase('ready'); updateSupport() }
    const onError = () => { window.clearTimeout(timeout); setPhase('error') }
    const onArStatus = (event: Event) => {
      const status = (event as CustomEvent<{ status?: string }>).detail?.status
      if (import.meta.env.DEV) console.debug('[SportSnap AR] camera overlay ar-status:', status)
      statusCallbackRef.current(status)
    }
    const timeout = window.setTimeout(onError, 60_000)
    const capabilityTimer = window.setInterval(updateSupport, 500)
    viewer.addEventListener('load', onLoad)
    viewer.addEventListener('error', onError)
    viewer.addEventListener('ar-status', onArStatus)
    document.addEventListener('visibilitychange', rotate)
    motion.addEventListener('change', rotate)
    rotate()
    updateSupport()
    if (viewer.loaded) onLoad()
    return () => {
      window.clearTimeout(timeout)
      window.clearInterval(capabilityTimer)
      viewer.removeEventListener('load', onLoad)
      viewer.removeEventListener('error', onError)
      viewer.removeEventListener('ar-status', onArStatus)
      document.removeEventListener('visibilitychange', rotate)
      motion.removeEventListener('change', rotate)
      viewer.autoRotate = false
      viewer.src = null
      // Removing the element also unregisters its scene from model-viewer's renderer.
    }
  }, [viewerActive, attempt])

  function activateAr() {
    const viewer = viewerRef.current
    if (!viewer || !viewer.loaded || phase !== 'ready' || !supported || launch.phase !== 'idle') return
    // The parent releases every camera track synchronously before invoking this callback.
    onActivateAr(() => viewer.activateAR())
  }

  return <div className="pointer-events-none absolute inset-2 flex flex-col items-center gap-1 sm:inset-3 sm:gap-2" aria-label="Mô hình 3D trên camera">
    <div className="max-w-full rounded-xl bg-black/75 px-3 py-1.5 text-center text-white" role="status">
      <h2 className="text-xl leading-tight font-bold sm:text-2xl">{name}</h2>
      <p className="mt-0.5 text-xs">{label} · Độ tin cậy: <span className="tabular-nums">{(confidence * 100).toLocaleString('vi-VN', { maximumFractionDigits: 1 })}%</span></p>
    </div>
    <div className="relative min-h-0 w-4/5 max-w-sm flex-1">
      {viewerActive && <model-viewer ref={viewerRef} src={modelSource(asset.glb, attempt)}
        alt={`Mô hình 3D đại diện môn ${name}`} ar ar-modes="scene-viewer quick-look"
        ar-placement="floor" ar-scale="auto" ios-src={asset.usdz}
        rotation-per-second="15deg" environment-image="neutral" shadow-intensity="0" loading="eager"
        className={`block h-full w-full ${phase === 'ready' ? 'camera-model-enter' : 'opacity-0'}`}
        style={{ backgroundColor: 'transparent' }}>
        <span slot="ar-button" hidden />
        <span slot="progress-bar" hidden />
      </model-viewer>}
      {(phase === 'library' || phase === 'model') && <p role="status" className="absolute inset-0 flex items-center justify-center text-center text-sm text-white drop-shadow-lg">Đang tải mô hình 3D…</p>}
      {phase === 'error' && <div role="alert" className="pointer-events-auto absolute inset-0 flex flex-col items-center justify-center gap-1 rounded-lg bg-black/75 px-2 text-center text-xs text-white">
        <p>Chưa tải được mô hình 3D.</p>
        <Button onClick={() => { setPhase('library'); setSupported(false); setAttempt(++retrySequence) }}>Thử lại</Button>
      </div>}
    </div>
    <div className="pointer-events-auto flex shrink-0 gap-2">
      <Button className="px-3" disabled={!cameraReady || launch.phase !== 'idle'} onClick={onRescan}><RotateCcw size={16} aria-hidden="true" />Quét lại</Button>
      <Button className="bg-black/80 px-3 text-white" disabled={phase !== 'ready' || !supported || launch.phase !== 'idle'} aria-describedby={noteId} onClick={activateAr}>
        <Box size={16} aria-hidden="true" />{phase === 'library' || phase === 'model' ? 'Đang tải mô hình...' : launch.phase === 'launching' ? 'Đang mở…' : launch.phase !== 'idle' ? 'Đang ở AR…' : launch.message ? 'Thử lại AR' : 'AR thật'}
      </Button>
    </div>
    <p id={noteId} role="status" className="max-w-full shrink-0 rounded bg-black/80 px-2 text-center text-[10px] leading-tight text-white">
      {launch.message ? 'Chưa mở được AR. Xem hướng dẫn bên dưới rồi thử lại.' : !window.isSecureContext ? 'AR thật cần HTTPS.' : phase === 'ready' && !supported ? 'Thiết bị chưa hỗ trợ AR thật; vẫn xem được overlay.' : 'Overlay camera · AR thật để đặt lên mặt bàn'}
    </p>
  </div>
}
