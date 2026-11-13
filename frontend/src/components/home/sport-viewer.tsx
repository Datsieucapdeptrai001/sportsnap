import { useEffect, useRef, useState } from 'react'
import type { ModelViewerElement } from '@google/model-viewer'
import { Box, LoaderCircle, RotateCcw, Smartphone } from 'lucide-react'
import { AR_VIEWER_ATTRIBUTES } from '../../lib/ar'
import { loadViewer } from '../../lib/model-viewer'
import { nextFallbackSrc, pickSportModel, type SportModel } from '../../lib/sport-models'
import { cn } from '../../lib/utils'

type Library = 'loading' | 'ready' | 'error'

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

function ModelStage({ model, label, onOpenAr }: { model: SportModel; label: string | null; onOpenAr?: () => void }) {
  const viewerRef = useRef<ModelViewerElement>(null)
  const [src, setSrc] = useState(model.src)
  const [loaded, setLoaded] = useState(false)
  const [broken, setBroken] = useState(false)
  const [canAr, setCanAr] = useState<boolean | null>(null)
  const [arNote, setArNote] = useState('')
  const usingFallback = src !== model.src
  const secure = window.isSecureContext
  const arAllowed = model.arAllowed

  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer) return
    const check = () => setCanAr(secure && viewer.canActivateAR)
    const onLoad = () => { setLoaded(true); check() }
    const onError = () => {
      setLoaded(false)
      // Never let a missing or broken GLB break the panel: sport -> trophy -> podium.
      const next = nextFallbackSrc(src)
      if (next) setSrc(next)
      else setBroken(true)
    }
    const onArStatus = (event: Event) => {
      const status = (event as CustomEvent<{ status?: string }>).detail?.status
      if (status === 'failed') setArNote('Chưa mở được AR. Bạn vẫn có thể xoay mô hình ngay tại đây.')
      else if (status === 'session-started') setArNote('Di chuyển điện thoại chậm để tìm mặt sàn, rồi chạm để đặt mô hình.')
      else if (status === 'not-presenting') setArNote('')
    }
    viewer.addEventListener('load', onLoad)
    viewer.addEventListener('error', onError)
    viewer.addEventListener('ar-status', onArStatus)
    const timer = window.setInterval(check, 600)
    if (viewer.loaded) onLoad()
    return () => {
      window.clearInterval(timer)
      viewer.removeEventListener('load', onLoad)
      viewer.removeEventListener('error', onError)
      viewer.removeEventListener('ar-status', onArStatus)
    }
  }, [src, secure])

  function openAr() {
    // Camera results hand AR to the scanner, which releases the camera first.
    if (onOpenAr) { if (loaded && arAllowed) onOpenAr(); return }
    const viewer = viewerRef.current
    if (!viewer || !loaded || !arAllowed || !viewer.canActivateAR) return
    setArNote('Đang mở AR… Nếu được hỏi, hãy cho phép dùng camera.')
    // Must stay inside the click gesture for Scene Viewer / Quick Look.
    void viewer.activateAR().catch(() => setArNote('Chưa mở được AR. Kiểm tra quyền camera rồi thử lại.'))
  }

  const name = label ?? 'Cúp'
  let note = ''
  if (model.reason === 'idle') note = 'Kéo để xoay, cuộn hoặc véo để phóng to.'
  else if (usingFallback) note = 'Chưa có mô hình riêng cho môn này, đang hiện mô hình cúp thay thế.'
  else if (!secure) note = 'AR cần trang được mở qua kết nối bảo mật (https). Bạn vẫn xoay được mô hình 3D tại đây.'
  else if (!onOpenAr && loaded && canAr === false) note = 'Thiết bị này chưa hỗ trợ AR. Mở trang trên điện thoại (Chrome trên Android hoặc Safari trên iPhone) để đặt mô hình vào phòng của bạn.'

  return (
    <>
      <div className="relative overflow-hidden rounded-2xl bg-[radial-gradient(ellipse_at_50%_85%,rgb(52_211_153/0.14),transparent_60%)]">
        {broken ? (
          <div className="flex h-64 flex-col items-center justify-center gap-2 px-6 text-center text-sm text-muted-foreground sm:h-80">
            <Box size={28} aria-hidden="true" />
            Chưa hiển thị được mô hình 3D trên thiết bị này. Kết quả nhận diện vẫn chính xác như trên.
          </div>
        ) : (
          <model-viewer
            key={src}
            ref={viewerRef}
            src={src}
            alt={model.isFallback || usingFallback ? 'Mô hình 3D cúp thay thế' : `Mô hình 3D môn ${name}`}
            {...AR_VIEWER_ATTRIBUTES}
            loading="eager"
            auto-rotate={!reducedMotion()}
            rotation-per-second="18deg"
            className="block h-64 w-full sm:h-80"
            style={{ touchAction: 'pan-y', background: 'transparent' }}
          >
            <span slot="ar-button" hidden />
            <span slot="progress-bar" hidden />
          </model-viewer>
        )}
        {!loaded && !broken && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <LoaderCircle size={18} className="motion-safe:animate-spin" aria-hidden="true" />Đang tải mô hình…
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={openAr}
        disabled={!arAllowed || !loaded || (!onOpenAr && !canAr)}
        className="mt-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-[15px] font-semibold text-primary-foreground transition-colors enabled:hover:bg-primary/90 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"
      >
        <Smartphone size={18} aria-hidden="true" />Xem trong không gian thực (AR)
      </button>
      {(arNote || note) && <p role="status" className="mt-3 text-sm leading-relaxed text-muted-foreground">{arNote || note}</p>}
    </>
  )
}

const confidenceFormat = new Intl.NumberFormat('vi-VN', { style: 'percent', maximumFractionDigits: 1 })

export function SportViewer({ result, onOpenAr }: { result: { label: string; is_uncertain: boolean; confidence?: number } | null; onOpenAr?: () => void }) {
  const [library, setLibrary] = useState<Library>('loading')
  const [attempt, setAttempt] = useState(0)
  const model = pickSportModel(result)

  useEffect(() => {
    let cancelled = false
    loadViewer()
      .then(() => { if (!cancelled) setLibrary('ready') })
      .catch(() => { if (!cancelled) setLibrary('error') })
    return () => { cancelled = true }
  }, [attempt])

  return (
    <section aria-labelledby="viewer-title" className="rounded-3xl border border-border bg-card/60 p-5 sm:p-6">
      {result ? (
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">{result.is_uncertain ? 'Chưa chắc chắn, có thể là' : 'Môn thể thao nhận diện được'}</p>
            <h2 id="viewer-title" className="mt-0.5 break-words font-display text-3xl leading-tight font-bold tracking-wide capitalize">{result.label}</h2>
          </div>
          {result.confidence !== undefined && (
            <span className={cn('shrink-0 rounded-full px-3 py-1 font-display text-lg font-bold tabular-nums',
              result.is_uncertain ? 'bg-warning/15 text-warning' : 'bg-primary/15 text-primary')}>
              {confidenceFormat.format(result.confidence)}
            </span>
          )}
        </div>
      ) : (
        <h2 id="viewer-title" className="font-display text-xl font-semibold tracking-wide">Mô hình 3D</h2>
      )}
      <div className={cn('mt-4', library !== 'ready' && 'min-h-64')}>
        {library === 'loading' && (
          <div className="flex h-64 items-center justify-center gap-2 text-sm text-muted-foreground sm:h-80">
            <LoaderCircle size={18} className="motion-safe:animate-spin" aria-hidden="true" />Đang chuẩn bị trình xem 3D…
          </div>
        )}
        {library === 'error' && (
          <div className="flex h-64 flex-col items-center justify-center gap-3 text-center text-sm text-muted-foreground sm:h-80">
            Không tải được trình xem 3D. Kiểm tra kết nối mạng rồi thử lại.
            <button type="button" onClick={() => { setLibrary('loading'); setAttempt((n) => n + 1) }}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-border px-4 font-medium text-foreground hover:border-primary/50">
              <RotateCcw size={16} aria-hidden="true" />Thử lại
            </button>
          </div>
        )}
        {library === 'ready' && <ModelStage key={model.src + model.reason} model={model} label={result?.label ?? null} onOpenAr={onOpenAr} />}
      </div>
    </section>
  )
}
