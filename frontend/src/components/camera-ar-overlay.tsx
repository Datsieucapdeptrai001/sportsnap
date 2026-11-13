import { useEffect, useRef, useState } from 'react'
import type { ModelViewerElement } from '@google/model-viewer'
import { LoaderCircle, RotateCcw, Smartphone, X } from 'lucide-react'
import { AR_VIEWER_ATTRIBUTES, modelLoadProgress, modelSource, type ArAsset } from '../lib/ar'
import { loadViewer } from '../lib/model-viewer'
import { nextFallbackSrc } from '../lib/sport-models'
import { sportNameVi } from '../lib/sport-names'
import { Button } from './ui/button'

type LoadPhase = 'library' | 'model' | 'ready' | 'error'
let retrySequence = 0

/**
 * Live camera AR overlay: a transparent, auto-rotating, drag-to-rotate
 * <model-viewer> floating over the running camera video.
 */
export function CameraArOverlay({ label, confidence, asset, cameraReady, onNativeAr, onRescan }: {
  label: string; confidence: number; asset: ArAsset
  cameraReady: boolean
  /** Called inside the click gesture with the loaded viewer, so it can call activateAR(). */
  onNativeAr: (viewer: ModelViewerElement) => void
  onRescan: () => void
}) {
  const viewerRef = useRef<ModelViewerElement>(null)
  const [attempt, setAttempt] = useState(0)
  const [src, setSrc] = useState(asset.glb)
  const [phase, setPhase] = useState<LoadPhase>('library')
  const [progress, setProgress] = useState(0)
  const name = sportNameVi(label)
  const viewerActive = phase === 'model' || phase === 'ready'
  const isFallback = src !== asset.glb

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
    const onLoad = () => { window.clearTimeout(timeout); setPhase('ready') }
    const onError = () => {
      window.clearTimeout(timeout)
      // Missing sport GLB -> trophy -> podium; only show an error when all fail.
      const next = nextFallbackSrc(src)
      if (next) { setProgress(0); setSrc(next) } else setPhase('error')
    }
    const onProgress = (event: Event) => {
      setProgress(modelLoadProgress((event as CustomEvent<{ totalProgress?: unknown }>).detail?.totalProgress))
    }
    const timeout = window.setTimeout(onError, 60_000)
    viewer.addEventListener('load', onLoad)
    viewer.addEventListener('error', onError)
    viewer.addEventListener('progress', onProgress)
    document.addEventListener('visibilitychange', rotate)
    motion.addEventListener('change', rotate)
    rotate()
    if (viewer.loaded) onLoad()
    return () => {
      window.clearTimeout(timeout)
      viewer.removeEventListener('load', onLoad)
      viewer.removeEventListener('error', onError)
      viewer.removeEventListener('progress', onProgress)
      document.removeEventListener('visibilitychange', rotate)
      motion.removeEventListener('change', rotate)
      viewer.autoRotate = false
    }
  }, [viewerActive, attempt, src])

  function retry() {
    setSrc(asset.glb)
    setProgress(0)
    setPhase('library')
    setAttempt(++retrySequence)
  }

  return <div className="absolute inset-0" aria-label="Mô hình 3D trên camera">
    <div className="pointer-events-none absolute top-3 left-3 z-10 max-w-[70%] rounded-2xl bg-black/70 px-3 py-1.5 text-white shadow-lg backdrop-blur" role="status">
      <p className="truncate text-lg leading-tight font-bold capitalize sm:text-xl">{name}</p>
      <p className="truncate text-xs text-white/80">
        <span className="capitalize">{label}</span> · <span className="tabular-nums">{(confidence * 100).toLocaleString('vi-VN', { maximumFractionDigits: 1 })}%</span>
        {isFallback && ' · mô hình thay thế'}
      </p>
    </div>
    <Button variant="outline" className="absolute top-3 right-3 z-10 min-h-10 border-white/30 bg-black/70 px-3 text-xs text-white hover:bg-black/85"
      disabled={!cameraReady} onClick={onRescan}>
      <X size={15} aria-hidden="true" />Tắt AR / Quét lại
    </Button>

    <div className="absolute inset-x-0 top-14 bottom-16 flex items-center justify-center">
      {viewerActive && <model-viewer key={`${src}:${attempt}`} ref={viewerRef} src={modelSource(src, attempt)}
        alt={isFallback ? 'Mô hình 3D cúp thay thế' : `Mô hình 3D môn ${name}`}
        {...AR_VIEWER_ATTRIBUTES}
        auto-rotate rotation-per-second="20deg" interaction-prompt="none" shadow-intensity="0" loading="eager"
        className={`block h-full w-4/5 max-w-md ${phase === 'ready' ? 'camera-model-enter' : 'opacity-0'}`}
        style={{ backgroundColor: 'transparent', touchAction: 'pan-y' }}>
        <span slot="ar-button" hidden />
        <span slot="progress-bar" hidden />
      </model-viewer>}
      {(phase === 'library' || phase === 'model') && <p role="status" className="pointer-events-none absolute inset-0 flex items-center justify-center gap-2 text-sm text-white drop-shadow-lg">
        <LoaderCircle size={18} className="motion-safe:animate-spin" aria-hidden="true" />
        {phase === 'library' ? 'Đang chuẩn bị mô hình 3D…' : `Đang tải mô hình 3D… ${progress}%`}
      </p>}
      {phase === 'error' && <div role="alert" className="flex flex-col items-center justify-center gap-2 rounded-2xl bg-black/75 px-4 py-3 text-center text-xs text-white">
        <p>Chưa tải được mô hình 3D.</p>
        <Button onClick={retry}><RotateCcw size={15} aria-hidden="true" />Thử lại</Button>
      </div>}
    </div>

    <div className="absolute inset-x-3 bottom-3 z-10 flex justify-center">
      <Button className="min-h-11 px-4 shadow-lg" disabled={phase !== 'ready'}
        onClick={() => { if (viewerRef.current) onNativeAr(viewerRef.current) }}>
        <Smartphone size={17} aria-hidden="true" />Mở AR không gian thực
      </Button>
    </div>
  </div>
}
