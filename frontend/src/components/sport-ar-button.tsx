import { useEffect, useId, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import type { ModelViewerElement } from '@google/model-viewer'
import { Box, LoaderCircle, RotateCcw, TriangleAlert, X } from 'lucide-react'
import { createViewerLoader, getArAvailability, modelLoadProgress, modelSource, type ArAsset } from '../lib/ar'
import { sports3d } from '../lib/sports3d'
import { Button } from './ui/button'
import { Progress } from './ui/progress'

// This callback is invoked only by a mounted AR dialog, never by Scan/Bulk startup.
const loadViewer = createViewerLoader(async () => {
  await import('@google/model-viewer')
  await customElements.whenDefined('model-viewer')
})
let retrySequence = 0

type LoadState =
  | { phase: 'library' | 'model'; progress: number }
  | { phase: 'ready'; progress: 100 }
  | { phase: 'error'; message: string }

function ArDialog({ label, asset, returnFocusRef, onClose }: {
  label: string; asset: ArAsset; returnFocusRef: RefObject<HTMLButtonElement | null>; onClose: () => void
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const viewerRef = useRef<ModelViewerElement>(null)
  const [attempt, setAttempt] = useState(0)
  const [libraryReady, setLibraryReady] = useState(false)
  const [state, setState] = useState<LoadState>({ phase: 'library', progress: 0 })
  const [arSupported, setArSupported] = useState<boolean | null>(null)
  const [arMessage, setArMessage] = useState('')
  const [launching, setLaunching] = useState(false)
  const titleId = useId()
  const descriptionId = useId()
  const supportId = useId()
  const secure = window.isSecureContext
  const ready = state.phase === 'ready'
  const viewerActive = libraryReady && state.phase !== 'error'

  useEffect(() => {
    const dialog = dialogRef.current
    // Safari may not focus a button on touch, so keep the explicit opener too.
    const previousFocus = returnFocusRef.current ?? document.activeElement
    const previousOverflow = document.body.style.overflow
    dialog?.showModal()
    document.body.style.overflow = 'hidden'
    return () => {
      dialog?.close()
      document.body.style.overflow = previousOverflow
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus()
    }
  }, [returnFocusRef])

  useEffect(() => {
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
  }, [attempt])

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
      if (status === 'failed') {
        setLaunching(false)
        setArMessage('Chưa mở được AR. Bạn vẫn có thể xoay mô hình 3D hoặc thử mở AR lại.')
      } else if (status === 'session-started') {
        setArMessage('Di chuyển điện thoại chậm để tìm mặt phẳng đặt mô hình.')
      } else if (status === 'object-placed') {
        setArMessage('Đã đặt mô hình. Bạn có thể véo để phóng to hoặc thu nhỏ.')
      } else if (status === 'not-presenting') {
        setLaunching(false)
        setArMessage('')
      }
      updateSupport()
    }
    viewer.addEventListener('load', onLoad)
    viewer.addEventListener('progress', onProgress)
    viewer.addEventListener('error', onError)
    viewer.addEventListener('ar-status', onArStatus)
    // Capability selection is asynchronous and has no dedicated ready event.
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
    if (state.phase !== 'model') return
    const timeout = window.setTimeout(() => {
      setState({ phase: 'error', message: 'Tải mô hình quá lâu. Kiểm tra kết nối mạng và bấm Thử lại.' })
    }, 60_000)
    return () => window.clearTimeout(timeout)
  }, [state.phase])

  function retryLoad() {
    setLibraryReady(false)
    setState({ phase: 'library', progress: 0 })
    setArSupported(null)
    setArMessage('')
    setLaunching(false)
    setAttempt(++retrySequence)
  }

  function activateAr() {
    const viewer = viewerRef.current
    if (!viewer || !ready || !secure || !viewer.canActivateAR) return
    setLaunching(true)
    setArMessage('Đang mở AR… Nếu trình duyệt yêu cầu, hãy cho phép truy cập camera.')
    // Keep activation in the user gesture for Scene Viewer and Quick Look.
    void viewer.activateAR().catch(() => {
      setArMessage('Không thể mở AR. Kiểm tra quyền camera hoặc thử lại trên trình duyệt hỗ trợ AR.')
    }).finally(() => setLaunching(false))
  }

  return createPortal(
    <dialog ref={dialogRef} aria-labelledby={titleId} aria-describedby={descriptionId}
      className="fixed inset-0 m-auto max-h-[95svh] w-[calc(100%_-_1rem)] max-w-2xl overflow-y-auto rounded-xl border border-border bg-card p-4 text-card-foreground shadow-xl backdrop:bg-black/80 sm:p-6"
      onCancel={(event) => { event.preventDefault(); event.stopPropagation(); onClose() }}
      onKeyDown={(event) => event.stopPropagation()}
      onClick={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div className="flex items-center justify-between gap-3">
        <h2 id={titleId} className="text-lg font-semibold">Xem 3D và AR · {label}</h2>
        <Button autoFocus variant="outline" className="size-11 shrink-0 p-0" aria-label="Đóng trình xem AR" onClick={onClose}><X size={20} aria-hidden="true" /></Button>
      </div>
      <p id={descriptionId} className="mt-3 text-sm leading-relaxed text-muted-foreground">Kéo để xoay mô hình 3D, véo để phóng to hoặc thu nhỏ. Khi mở AR, hướng camera về mặt bàn hoặc sàn.</p>
      <div className="relative mt-4 min-h-48 overflow-hidden rounded-xl bg-muted/40" aria-busy={state.phase === 'library' || state.phase === 'model'}>
        {libraryReady && state.phase !== 'error' && <model-viewer key={attempt} ref={viewerRef}
          src={modelSource(asset.glb, attempt)} alt={`Mô hình 3D đại diện môn ${label}`} ar
          ar-modes="webxr scene-viewer quick-look" ar-placement="floor" ar-scale="auto"
          ios-src={asset.usdz} camera-controls auto-rotate={!window.matchMedia('(prefers-reduced-motion: reduce)').matches}
          shadow-intensity="1" environment-image="neutral" loading="lazy"
          className="block h-[min(52svh,26rem)] min-h-48 w-full" style={{ touchAction: 'pan-y' }}>
          <span slot="ar-button" hidden />
          <span slot="progress-bar" hidden />
        </model-viewer>}
        {state.phase === 'library' && <div className="flex min-h-48 items-center justify-center gap-2 text-sm"><LoaderCircle className="motion-safe:animate-spin" size={20} aria-hidden="true" />Đang tải trình xem 3D…</div>}
        {state.phase === 'error' && <div role="alert" className="flex min-h-48 flex-col items-center justify-center gap-4 p-5 text-center"><TriangleAlert className="text-destructive" size={28} aria-hidden="true" /><p className="text-sm">{state.message}</p><Button variant="outline" onClick={retryLoad}><RotateCcw size={18} aria-hidden="true" />Thử lại</Button></div>}
      </div>
      {(state.phase === 'library' || state.phase === 'model') && <div className="mt-4 space-y-2" role="status"><p className="text-sm">{state.phase === 'library' ? 'Đang chuẩn bị trình xem…' : `Đang tải mô hình: ${state.progress}%`}</p><Progress value={state.progress} label="Tiến độ tải mô hình 3D" /></div>}
      <Button className="mt-4 w-full" disabled={!ready || !arSupported || launching} aria-describedby={supportId} onClick={activateAr}><Box size={18} aria-hidden="true" />{launching ? 'Đang mở AR…' : 'Xem trong AR'}</Button>
      <p id={supportId} role="status" className="mt-3 text-sm leading-relaxed text-muted-foreground">
        {state.phase === 'error' ? 'Tải lại mô hình để tiếp tục xem 3D và kiểm tra AR.'
          : !secure ? 'AR cần kết nối HTTPS. Bạn vẫn có thể xem và xoay mô hình 3D tại đây.'
          : ready && arSupported === false ? 'Thiết bị hoặc trình duyệt này không hỗ trợ AR. Bạn vẫn có thể xem và xoay mô hình 3D.'
            : ready && arSupported ? 'Bấm Xem trong AR để đặt mô hình. Bạn có thể điều chỉnh kích thước bằng hai ngón tay.'
              : 'Đang kiểm tra khả năng hỗ trợ AR…'}
      </p>
      {arMessage && <p role="status" className="mt-3 text-sm leading-relaxed">{arMessage}</p>}
    </dialog>, document.body,
  )
}

export function SportArButton({ label, isUncertain }: { label: string; isUncertain: boolean }) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const noteId = useId()
  const availability = getArAvailability(label, isUncertain, sports3d)
  return <>
    <div>
      <Button ref={triggerRef} variant="outline" disabled={!availability.enabled} aria-haspopup="dialog" aria-expanded={open}
        aria-describedby={availability.message ? noteId : undefined} onClick={() => setOpen(true)}>
        <Box size={17} aria-hidden="true" />Xem AR
      </Button>
      {availability.message && <p id={noteId} className="mt-2 text-xs leading-relaxed text-muted-foreground">{availability.message}</p>}
    </div>
    {open && availability.enabled && <ArDialog key={`${label}:${availability.asset.glb}`} label={label} asset={availability.asset} returnFocusRef={triggerRef} onClose={() => setOpen(false)} />}
  </>
}
