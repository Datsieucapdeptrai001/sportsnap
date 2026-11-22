import { lazy, Suspense, useEffect, useId, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import type { ModelViewerElement } from '@google/model-viewer'
import { Box, LoaderCircle, Pause, Play, RotateCcw, TriangleAlert, X } from 'lucide-react'
import { AR_VIEWER_ATTRIBUTES, getArAvailability, modelLoadProgress, modelSource, type ArAsset } from '../lib/ar'
import { loadViewer } from '../lib/model-viewer'
import { sportNameVi } from '../lib/sport-names'
import { sports3d } from '../lib/sports3d'
import { BASKETBALL_LABEL, SOCCER_LABEL, hasInteractiveGame, interactiveTabLabel } from '../lib/interactive-ar/games'
import { Button } from './ui/button'
import { Progress } from './ui/progress'

// Games are code-split so three.js and the canvas engine load only when a player opens one.
const BasketballGame = lazy(() => import('./ar/basketball-game').then((module) => ({ default: module.BasketballGame })))
const SoccerGame = lazy(() => import('./ar/soccer-game').then((module) => ({ default: module.SoccerGame })))
const SportGame = lazy(() => import('./ar/sport-game').then((module) => ({ default: module.SportGame })))

let retrySequence = 0

type LoadState =
  | { phase: 'library' | 'model'; progress: number }
  | { phase: 'ready'; progress: 100 }
  | { phase: 'error'; message: string }

export function SportArDialog({ label, confidence, asset, returnFocusRef, onClose, onArReturn }: {
  label: string; confidence?: number; asset: ArAsset; returnFocusRef: RefObject<HTMLButtonElement | null>; onClose: () => void
  onArReturn?: () => void
}) {
  const sportName = sportNameVi(label)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const viewerRef = useRef<ModelViewerElement>(null)
  const arReturnRef = useRef(onArReturn)
  const sessionStartedRef = useRef(false)
  const [attempt, setAttempt] = useState(0)
  const [libraryReady, setLibraryReady] = useState(false)
  const [state, setState] = useState<LoadState>({ phase: 'library', progress: 0 })
  const [arSupported, setArSupported] = useState<boolean | null>(null)
  const [arMessage, setArMessage] = useState('')
  const [launching, setLaunching] = useState(false)
  const [spinning, setSpinning] = useState(() => !window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const hasGame = hasInteractiveGame(label)
  const [activeTab, setActiveTab] = useState<'model' | 'interactive'>(hasGame ? 'interactive' : 'model')
  const titleId = useId()
  const descriptionId = useId()
  const supportId = useId()
  const secure = window.isSecureContext
  const ready = state.phase === 'ready'
  const isModelTab = activeTab === 'model'
  const viewerActive = isModelTab && libraryReady && state.phase !== 'error'

  useEffect(() => { arReturnRef.current = onArReturn }, [onArReturn])

  useEffect(() => {
    const dialog = dialogRef.current
    const previousFocus = returnFocusRef.current ?? document.activeElement
    const previousOverflow = document.body.style.overflow
    dialog?.showModal()
    if (import.meta.env.DEV) console.info('[SportSnap AR] shared dialog mounted')
    document.body.style.overflow = 'hidden'
    return () => {
      dialog?.close()
      document.body.style.overflow = previousOverflow
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus()
    }
  }, [returnFocusRef])

  // Only load @google/model-viewer when the 3D/AR tab is actually active (prevents 60s timeout during games).
  useEffect(() => {
    if (!isModelTab || libraryReady) return
    let cancelled = false
    const timeout = window.setTimeout(() => {
      cancelled = true
      setState({ phase: 'error', message: 'Tải trình xem quá lâu. Kiểm tra kết nối mạng và bấm Thử lại.' })
    }, 60_000)
    loadViewer().then(() => {
      window.clearTimeout(timeout)
      if (!cancelled) {
        setState({ phase: 'model', progress: 0 })
        setLibraryReady(true)
      }
    }).catch(() => {
      window.clearTimeout(timeout)
      if (!cancelled) setState({ phase: 'error', message: 'Không tải được trình xem 3D. Kiểm tra kết nối mạng rồi thử lại.' })
    })
    return () => { cancelled = true; window.clearTimeout(timeout) }
  }, [attempt, isModelTab, libraryReady])

  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewerActive || !viewer) return
    const updateSupport = () => setArSupported(secure && viewer.canActivateAR)
    const onLoad = () => { setState({ phase: 'ready', progress: 100 }); updateSupport() }
    const onProgress = (event: Event) => {
      const progress = modelLoadProgress((event as CustomEvent<{ totalProgress?: unknown }>).detail?.totalProgress)
      setState((previous) => previous.phase === 'model' ? { phase: 'model', progress } : previous)
    }
    const onError = () => setState({ phase: 'error', message: 'Không tải hoặc hiển thị được mô hình 3D. Kiểm tra kết nối mạng rồi thử lại.' })
    const onArStatus = (event: Event) => {
      const status = (event as CustomEvent<{ status?: string }>).detail?.status
      if (import.meta.env.DEV) console.debug('[SportSnap AR] dialog ar-status:', status)
      if (status === 'failed') {
        setLaunching(false)
        setArMessage('Chưa mở được AR. Bạn vẫn có thể xoay mô hình 3D hoặc thử mở AR lại.')
      } else if (status === 'session-started') {
        sessionStartedRef.current = true
        setArMessage('Di chuyển điện thoại chậm để tìm mặt phẳng đặt mô hình.')
      } else if (status === 'object-placed') {
        setArMessage('Đã đặt mô hình. Bạn có thể véo để phóng to hoặc thu nhỏ.')
      } else if (status === 'not-presenting') {
        setLaunching(false)
        setArMessage('')
        if (sessionStartedRef.current) {
          sessionStartedRef.current = false
          arReturnRef.current?.()
        }
      }
      updateSupport()
    }
    viewer.addEventListener('load', onLoad)
    viewer.addEventListener('progress', onProgress)
    viewer.addEventListener('error', onError)
    viewer.addEventListener('ar-status', onArStatus)
    const capabilityTimer = window.setInterval(updateSupport, 500)
    if (viewer.loaded) onLoad()
    return () => {
      window.clearInterval(capabilityTimer)
      viewer.removeEventListener('load', onLoad)
      viewer.removeEventListener('progress', onProgress)
      viewer.removeEventListener('error', onError)
      viewer.removeEventListener('ar-status', onArStatus)
    }
  }, [viewerActive, attempt, secure])

  useEffect(() => {
    if (!isModelTab || state.phase !== 'model') return
    const timeout = window.setTimeout(() => {
      setState({ phase: 'error', message: 'Tải mô hình quá lâu. Kiểm tra kết nối mạng và bấm Thử lại.' })
    }, 60_000)
    return () => window.clearTimeout(timeout)
  }, [isModelTab, state.phase])

  useEffect(() => {
    const viewer = viewerRef.current
    if (viewer) viewer.autoRotate = spinning
  }, [spinning, ready])

  function retryLoad() {
    setLibraryReady(false)
    setState({ phase: 'library', progress: 0 })
    setArSupported(null)
    setArMessage('')
    setLaunching(false)
    setAttempt(++retrySequence)
  }

  function resetOrbit() {
    const viewer = viewerRef.current as (ModelViewerElement & {
      cameraOrbit?: string
      cameraTarget?: string
      resetTurntableRotation?: () => void
    }) | null
    if (!viewer) return
    viewer.cameraOrbit = 'auto auto auto'
    viewer.cameraTarget = 'auto auto auto'
    viewer.resetTurntableRotation?.()
  }

  function activateAr() {
    const viewer = viewerRef.current
    if (!viewer || !ready || !secure || !viewer.canActivateAR) return
    setLaunching(true)
    setArMessage('Đang mở AR… Nếu trình duyệt yêu cầu, hãy cho phép truy cập camera.')
    void viewer.activateAR().catch(() => {
      setArMessage('Không thể mở AR. Kiểm tra quyền camera hoặc thử lại trên trình duyệt hỗ trợ AR.')
    }).finally(() => setLaunching(false))
  }

  return createPortal(
    <dialog ref={dialogRef} aria-labelledby={titleId} aria-describedby={descriptionId}
      className="fixed inset-0 m-auto max-h-[95svh] w-[calc(100%_-_1rem)] max-w-2xl overflow-y-auto rounded-xl border border-border bg-card p-4 text-card-foreground shadow-2xl backdrop:bg-black/75 sm:p-6"
      onCancel={(event) => { event.preventDefault(); event.stopPropagation(); onClose() }}
      onKeyDown={(event) => event.stopPropagation()}
      onClick={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="mb-2 text-sm text-muted-foreground">Xem 3D và AR</p>
          <h2 id={titleId} className="break-words text-4xl leading-[1.05] font-bold tracking-[-0.02em] sm:text-5xl">{sportName}</h2>
          <p className="mt-1 text-xs text-muted-foreground">{label}</p>
          {confidence !== undefined && <p className="mt-3 font-semibold text-primary tabular-nums">Độ tin cậy: {(confidence * 100).toLocaleString('vi-VN', { maximumFractionDigits: 1 })}%</p>}
        </div>
        <Button autoFocus variant="outline" className="size-11 shrink-0 p-0" aria-label="Đóng trình xem AR" onClick={onClose}><X size={20} aria-hidden="true" /></Button>
      </div>
      {hasGame && (
        <div className="mt-3 flex rounded-lg bg-muted p-1 text-xs font-medium sm:text-sm">
          <button
            type="button"
            className={`flex-1 rounded-md py-1.5 text-center transition-all ${activeTab === 'model' ? 'bg-card font-semibold text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
            onClick={() => setActiveTab('model')}
          >
            Mô hình 3D & AR
          </button>
          <button
            type="button"
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 text-center transition-all ${activeTab === 'interactive' ? 'bg-primary font-semibold text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
            onClick={() => setActiveTab('interactive')}
          >
            <span className="truncate">{interactiveTabLabel(label)}</span>
            <span className="rounded-full bg-amber-400 px-1.5 py-0.5 text-[10px] font-bold text-slate-950">
              {label === BASKETBALL_LABEL || label === SOCCER_LABEL ? '3D' : 'AR'}
            </span>
          </button>
        </div>
      )}
      {activeTab === 'interactive' && hasGame ? (
        <div className="mt-4">
          <Suspense fallback={<div role="status" className="flex min-h-48 items-center justify-center gap-2 text-sm"><LoaderCircle className="motion-safe:animate-spin" size={20} aria-hidden="true" />Đang tải trò chơi…</div>}>
            {label === BASKETBALL_LABEL ? <BasketballGame onClose={onClose} /> : label === SOCCER_LABEL ? <SoccerGame onClose={onClose} /> : <SportGame label={label} />}
          </Suspense>
        </div>
      ) : (
        <>
          <p id={descriptionId} className="mt-3 text-sm leading-relaxed text-muted-foreground">Kéo để xoay mô hình 3D, véo để phóng to hoặc thu nhỏ. Khi mở AR, hướng camera về mặt bàn hoặc sàn.</p>
          <div className="relative mt-4 min-h-48 overflow-hidden rounded-xl border border-border bg-lane" aria-busy={state.phase === 'library' || state.phase === 'model'}>
            {libraryReady && state.phase !== 'error' && (
              <model-viewer
                key={attempt}
                ref={viewerRef}
                src={modelSource(asset.glb, attempt)}
                alt={`Mô hình 3D đại diện môn ${sportName}`}
                {...AR_VIEWER_ATTRIBUTES}
                ios-src={asset.usdz}
                auto-rotate={spinning}
                className="block h-[min(52svh,26rem)] min-h-48 w-full"
                style={{ touchAction: 'pan-y' }}
              >
                <span slot="ar-button" hidden />
                <span slot="progress-bar" hidden />
                <div className="pointer-events-none absolute top-3 left-3 max-w-[85%] rounded-lg bg-black/75 px-3 py-2 text-lg font-semibold text-white">{sportName}</div>
              </model-viewer>
            )}
            {ready && (
              <div className="absolute right-3 bottom-3 flex items-center gap-1 rounded-full border border-white/15 bg-black/65 p-1 text-white backdrop-blur">
                <button
                  type="button"
                  onClick={() => setSpinning((v) => !v)}
                  aria-label={spinning ? 'Tạm dừng xoay' : 'Xoay tự động'}
                  className="inline-flex size-8 items-center justify-center rounded-full hover:bg-white/15"
                >
                  {spinning ? <Pause size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}
                </button>
                <button
                  type="button"
                  onClick={resetOrbit}
                  aria-label="Đặt lại góc nhìn"
                  className="inline-flex size-8 items-center justify-center rounded-full hover:bg-white/15"
                >
                  <RotateCcw size={14} aria-hidden="true" />
                </button>
              </div>
            )}
            {state.phase === 'library' && <div className="flex min-h-48 items-center justify-center gap-2 text-sm"><LoaderCircle className="motion-safe:animate-spin" size={20} aria-hidden="true" />Đang tải trình xem 3D…</div>}
            {state.phase === 'error' && <div role="alert" className="flex min-h-48 flex-col items-center justify-center gap-4 p-5 text-center"><TriangleAlert className="text-destructive" size={28} aria-hidden="true" /><p className="text-sm">{state.message}</p><Button variant="outline" onClick={retryLoad}><RotateCcw size={18} aria-hidden="true" />Thử lại</Button></div>}
          </div>
          {(state.phase === 'library' || state.phase === 'model') && <div className="mt-4 space-y-2" role="status"><p className="text-sm">{state.phase === 'library' ? 'Đang chuẩn bị trình xem…' : `Đang tải mô hình: ${state.progress}%`}</p><Progress value={state.progress} label="Tiến độ tải mô hình 3D" /></div>}
          <Button className="mt-4 min-h-14 w-full text-base font-semibold" disabled={!ready || !arSupported || launching} aria-describedby={supportId} onClick={activateAr}><Box size={22} aria-hidden="true" />{launching ? 'Đang mở AR…' : 'Xem trong AR'}</Button>
          <p className="mt-2 text-center text-sm text-muted-foreground">Chạm để đặt vật lên bàn</p>
          <p id={supportId} role="status" className="mt-3 text-sm leading-relaxed text-muted-foreground">
            {state.phase === 'error' ? 'Tải lại mô hình để tiếp tục xem 3D và kiểm tra AR.'
              : !secure ? 'AR cần kết nối HTTPS. Bạn vẫn có thể xem và xoay mô hình 3D tại đây.'
              : ready && arSupported === false ? 'Thiết bị hoặc trình duyệt này không hỗ trợ AR. Bạn vẫn có thể xem và xoay mô hình 3D.'
                : ready && arSupported ? 'Bấm Xem trong AR để đặt mô hình. Bạn có thể điều chỉnh kích thước bằng hai ngón tay.'
                  : 'Đang kiểm tra khả năng hỗ trợ AR…'}
          </p>
          {arMessage && <p role="status" className="mt-3 text-sm leading-relaxed">{arMessage}</p>}
        </>
      )}
    </dialog>, document.body,
  )
}

export function SportArButton({ label, isUncertain, confidence, otherDialogOpen = false, onOpen }: {
  label: string; isUncertain: boolean; confidence?: number; otherDialogOpen?: boolean
  onOpen?: () => void
}) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const noteId = useId()
  const availability = getArAvailability(label, isUncertain, sports3d)
  function openManually() {
    if (otherDialogOpen) return
    if (onOpen) { onOpen(); return }
    setOpen(true)
  }
  const buttonText = label === BASKETBALL_LABEL
    ? '🏀 Ném bóng rổ 3D AR'
    : label === SOCCER_LABEL
      ? '⚽ Sút phạt đền 3D AR'
      : hasInteractiveGame(label)
        ? '🎮 Chơi & xem AR'
        : 'Xem AR'

  return <>
    <div>
      <Button ref={triggerRef} variant="outline" className="min-h-12 w-full" disabled={!availability.enabled} aria-haspopup="dialog" aria-expanded={open}
        aria-describedby={availability.message ? noteId : undefined} onClick={openManually}>
        <Box size={17} aria-hidden="true" />{buttonText}
      </Button>
      {availability.message && <p id={noteId} className="mt-2 text-xs leading-relaxed text-muted-foreground">{availability.message}</p>}
    </div>
    {open && availability.enabled && <SportArDialog key={`${label}:${availability.asset.glb}`} label={label} confidence={confidence} asset={availability.asset} returnFocusRef={triggerRef} onClose={() => setOpen(false)} />}
  </>
}
