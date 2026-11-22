import { useEffect, useRef, useState } from 'react'
import type { ModelViewerElement } from '@google/model-viewer'
import { Camera, Gamepad2, LoaderCircle, Pause, Play, RotateCcw, Smartphone, X } from 'lucide-react'
import { toast } from 'sonner'
import { AR_VIEWER_ATTRIBUTES, modelLoadProgress, modelSource, type ArAsset } from '../lib/ar'
import { loadViewer } from '../lib/model-viewer'
import { nextFallbackSrc } from '../lib/sport-models'
import { sportNameVi } from '../lib/sport-names'
import { hasInteractiveGame } from '../lib/interactive-ar/games'
import { Button } from './ui/button'

type LoadPhase = 'library' | 'model' | 'ready' | 'error'
let retrySequence = 0

const SCALE_STEPS = [0.7, 1.0, 1.4] as const

/**
 * Live camera AR overlay: a transparent, auto-rotating, drag-to-rotate
 * <model-viewer> floating over the running camera video, with live scale,
 * pause/play spin, AR snapshot capture, and 1-tap mini-game launch.
 */
export function CameraArOverlay({
  label,
  confidence,
  asset,
  cameraReady,
  videoRef,
  onNativeAr,
  onOpenGame,
  onRescan,
}: {
  label: string
  confidence: number
  asset: ArAsset
  cameraReady: boolean
  videoRef?: React.RefObject<HTMLVideoElement | null>
  /** Called inside the click gesture with the loaded viewer, so it can call activateAR(). */
  onNativeAr: (viewer: ModelViewerElement) => void
  onOpenGame?: () => void
  onRescan: () => void
}) {
  const viewerRef = useRef<ModelViewerElement>(null)
  const [attempt, setAttempt] = useState(0)
  const [src, setSrc] = useState(asset.glb)
  const [phase, setPhase] = useState<LoadPhase>('library')
  const [progress, setProgress] = useState(0)
  const [scaleFactor, setScaleFactor] = useState<number>(1.0)
  const [spinning, setSpinning] = useState(true)
  const [capturing, setCapturing] = useState(false)
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
    const rotate = () => { viewer.autoRotate = spinning && !document.hidden && !motion.matches }
    const onLoad = () => { window.clearTimeout(timeout); setPhase('ready') }
    const onError = () => {
      window.clearTimeout(timeout)
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
  }, [viewerActive, attempt, src, spinning])

  function retry() {
    setSrc(asset.glb)
    setProgress(0)
    setPhase('library')
    setAttempt(++retrySequence)
  }

  async function captureArSnapshot() {
    const viewer = viewerRef.current as (ModelViewerElement & { toDataURL?: (type?: string) => string }) | null
    if (!viewer || phase !== 'ready' || capturing) return
    setCapturing(true)
    try {
      const video = videoRef?.current
      const w = video && video.videoWidth > 0 ? video.videoWidth : 960
      const h = video && video.videoHeight > 0 ? video.videoHeight : 720
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('no-canvas')

      if (video && video.videoWidth > 0) {
        ctx.drawImage(video, 0, 0, w, h)
      } else {
        ctx.fillStyle = '#0d161d'
        ctx.fillRect(0, 0, w, h)
      }

      const modelDataUrl = viewer.toDataURL?.('image/png')
      if (modelDataUrl) {
        await new Promise<void>((resolve) => {
          const img = new Image()
          img.onload = () => {
            const boxW = w * 0.72 * scaleFactor
            const boxH = h * 0.72 * scaleFactor
            const aspect = img.width / Math.max(img.height, 1)
            let drawW = boxW
            let drawH = boxW / aspect
            if (drawH > boxH) {
              drawH = boxH
              drawW = boxH * aspect
            }
            ctx.drawImage(img, (w - drawW) / 2, (h - drawH) / 2, drawW, drawH)
            resolve()
          }
          img.onerror = () => resolve()
          img.src = modelDataUrl
        })
      }

      // Draw crisp SportSnap Vietnamese HUD badge at bottom-left
      const pad = Math.round(w * 0.03)
      const badgeW = Math.min(w - pad * 2, Math.round(w * 0.56))
      const badgeH = Math.round(h * 0.13)
      ctx.fillStyle = 'rgba(13, 22, 29, 0.78)'
      ctx.beginPath()
      ctx.roundRect(pad, h - badgeH - pad, badgeW, badgeH, 16)
      ctx.fill()
      ctx.fillStyle = '#34d399'
      ctx.font = `700 ${Math.round(badgeH * 0.36)}px system-ui, -apple-system, sans-serif`
      ctx.fillText(name, pad + 18, h - pad - badgeH * 0.52)
      ctx.fillStyle = 'rgba(255,255,255,0.85)'
      ctx.font = `500 ${Math.round(badgeH * 0.24)}px system-ui, -apple-system, sans-serif`
      const pct = (confidence * 100).toLocaleString('vi-VN', { maximumFractionDigits: 1 })
      ctx.fillText(`SportSnap AR · ${label} · ${pct}%`, pad + 18, h - pad - badgeH * 0.18)

      const link = document.createElement('a')
      const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '_')
      link.download = `sportsnap-ar-${slug}.png`
      link.href = canvas.toDataURL('image/png')
      link.click()
      toast.success('Đã lưu ảnh chụp AR!')
    } catch {
      toast.error('Chưa chụp được ảnh AR trên trình duyệt này.')
    } finally {
      setCapturing(false)
    }
  }

  return (
    <div className="absolute inset-0" aria-label="Mô hình 3D trên camera">
      <div className="pointer-events-none absolute top-3 left-3 z-10 max-w-[65%] rounded-2xl bg-black/70 px-3 py-1.5 text-white shadow-lg backdrop-blur" role="status">
        <p className="truncate text-lg leading-tight font-bold capitalize sm:text-xl">{name}</p>
        <p className="truncate text-xs text-white/80">
          <span className="capitalize">{label}</span> · <span className="tabular-nums">{(confidence * 100).toLocaleString('vi-VN', { maximumFractionDigits: 1 })}%</span>
          {isFallback && ' · mô hình thay thế'}
        </p>
      </div>
      <div className="absolute top-3 right-3 z-10 flex items-center gap-1.5">
        {phase === 'ready' && (
          <Button
            variant="outline"
            className="size-10 min-h-10 border-white/30 bg-black/70 p-0 text-white hover:bg-black/85"
            aria-label={spinning ? 'Tạm dừng xoay 3D' : 'Tiếp tục xoay 3D'}
            onClick={() => setSpinning((v) => !v)}
          >
            {spinning ? <Pause size={15} aria-hidden="true" /> : <Play size={15} aria-hidden="true" />}
          </Button>
        )}
        <Button
          variant="outline"
          className="min-h-10 border-white/30 bg-black/70 px-3 text-xs text-white hover:bg-black/85"
          disabled={!cameraReady}
          onClick={onRescan}
        >
          <X size={15} aria-hidden="true" />Tắt AR / Quét lại
        </Button>
      </div>

      <div className="absolute inset-x-0 top-14 bottom-24 flex items-center justify-center">
        {viewerActive && (
          <model-viewer
            key={`${src}:${attempt}`}
            ref={viewerRef}
            src={modelSource(src, attempt)}
            alt={isFallback ? 'Mô hình 3D cúp thay thế' : `Mô hình 3D môn ${name}`}
            {...AR_VIEWER_ATTRIBUTES}
            scale={`${scaleFactor} ${scaleFactor} ${scaleFactor}`}
            auto-rotate={spinning}
            rotation-per-second="20deg"
            interaction-prompt="none"
            shadow-intensity="0"
            loading="eager"
            className={`block h-full w-4/5 max-w-md ${phase === 'ready' ? 'camera-model-enter' : 'opacity-0'}`}
            style={{ backgroundColor: 'transparent', touchAction: 'pan-y' }}
          >
            <span slot="ar-button" hidden />
            <span slot="progress-bar" hidden />
          </model-viewer>
        )}
        {(phase === 'library' || phase === 'model') && (
          <p role="status" className="pointer-events-none absolute inset-0 flex items-center justify-center gap-2 text-sm text-white drop-shadow-lg">
            <LoaderCircle size={18} className="motion-safe:animate-spin" aria-hidden="true" />
            {phase === 'library' ? 'Đang chuẩn bị mô hình 3D…' : `Đang tải mô hình 3D… ${progress}%`}
          </p>
        )}
        {phase === 'error' && (
          <div role="alert" className="flex flex-col items-center justify-center gap-2 rounded-2xl bg-black/75 px-4 py-3 text-center text-xs text-white">
            <p>Chưa tải được mô hình 3D.</p>
            <Button onClick={retry}><RotateCcw size={15} aria-hidden="true" />Thử lại</Button>
          </div>
        )}
      </div>

      <div className="absolute inset-x-3 bottom-3 z-10 flex flex-col items-center gap-2">
        {phase === 'ready' && (
          <div className="flex items-center gap-1 rounded-full border border-white/20 bg-black/70 px-2 py-1 text-xs text-white backdrop-blur" role="group" aria-label="Tỷ lệ mô hình 3D">
            {SCALE_STEPS.map((val) => (
              <button
                key={val}
                type="button"
                onClick={() => setScaleFactor(val)}
                className={`rounded-full px-2.5 py-0.5 font-medium tabular-nums transition-colors ${scaleFactor === val ? 'bg-primary text-primary-foreground' : 'text-white/80 hover:bg-white/15'}`}
              >
                {val.toFixed(1)}×
              </button>
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button
            className="min-h-11 px-3.5 text-xs shadow-lg sm:text-sm"
            disabled={phase !== 'ready'}
            onClick={() => { if (viewerRef.current) onNativeAr(viewerRef.current) }}
          >
            <Smartphone size={16} aria-hidden="true" />Mở AR không gian thực
          </Button>
          {onOpenGame && hasInteractiveGame(label) && (
            <Button
              variant="outline"
              className="min-h-11 border-white/30 bg-black/70 px-3.5 text-xs text-white shadow-lg hover:bg-black/85 sm:text-sm"
              disabled={phase !== 'ready'}
              onClick={onOpenGame}
            >
              <Gamepad2 size={16} aria-hidden="true" />Mini-game AR
            </Button>
          )}
          <Button
            variant="outline"
            className="min-h-11 border-white/30 bg-black/70 px-3 text-xs text-white shadow-lg hover:bg-black/85"
            disabled={phase !== 'ready' || capturing}
            aria-label="Chụp ảnh AR"
            onClick={() => void captureArSnapshot()}
          >
            <Camera size={16} aria-hidden="true" />Chụp ảnh AR
          </Button>
        </div>
      </div>
    </div>
  )
}
