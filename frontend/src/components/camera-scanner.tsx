import { useEffect, useId, useImperativeHandle, useRef, useState, type Ref } from 'react'
import { Camera, ScanLine, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'
import { scanFrames, type ScanResult } from '../lib/api'
import { CAMERA_CONSTRAINTS, cameraErrorMessage, captureFrames, checkCameraSupport, getCropOverlay } from '../lib/camera'
import { Button } from './ui/button'
import { Skeleton } from './ui/skeleton'
import { selectBestFrame } from '../lib/explain'
import { createCameraArHandoff, getArAvailability, getCameraOverlayAsset, releaseCameraForAr, type CameraArPhase } from '../lib/ar'
import { sports3d } from '../lib/sports3d'
import { CameraArOverlay } from './camera-ar-overlay'
import { SportArDialog } from './sport-ar-button'

export interface CameraScannerHandle { openAr: () => void }

type CameraState =
  | { status: 'starting' | 'ready' | 'sending' | 'ar-paused' }
  | { status: 'capturing'; count: number }
  | { status: 'error'; message: string }

export function CameraScanner({ onResult, result, autoOverlay, onReset, ref }: {
  onResult: (result: ScanResult, image: Blob | null) => void
  result: ScanResult | null
  autoOverlay: boolean
  onReset: () => void
  ref?: Ref<CameraScannerHandle>
}) {
  const guideId = useId()
  const previewRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const requestRef = useRef<AbortController | null>(null)
  const busyRef = useRef(false)
  const stopForArRef = useRef<(() => void) | null>(null)
  const arHandoffRef = useRef<ReturnType<typeof createCameraArHandoff> | null>(null)
  const returnFocusRef = useRef<HTMLButtonElement>(null)
  const [arPhase, setArPhase] = useState<CameraArPhase>('camera')
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<CameraState>({ status: 'starting' })
  const [scanError, setScanError] = useState<string | null>(null)
  const [overlay, setOverlay] = useState<ReturnType<typeof getCropOverlay>>(null)

  useImperativeHandle(ref, () => ({ openAr: () => {
    if (result && getArAvailability(result.label, result.is_uncertain, sports3d).enabled) arHandoffRef.current?.begin()
  } }), [result])

  useEffect(() => {
    const video = videoRef.current
    const preview = previewRef.current
    if (!video || !preview) return
    const updateOverlay = () => {
      const { width, height } = preview.getBoundingClientRect()
      setOverlay(getCropOverlay(video.videoWidth, video.videoHeight, width, height))
    }
    const observer = new ResizeObserver(updateOverlay)
    observer.observe(preview)
    video.addEventListener('loadedmetadata', updateOverlay)
    // Video resize fires when intrinsic dimensions change, including rotation.
    video.addEventListener('resize', updateOverlay)
    return () => {
      observer.disconnect()
      video.removeEventListener('loadedmetadata', updateOverlay)
      video.removeEventListener('resize', updateOverlay)
    }
  }, [])

  useEffect(() => {
    const video = videoRef.current
    let disposed = false
    let failed = false
    let stream: MediaStream | undefined
    const stop = () => {
      stream?.getVideoTracks().forEach((track) => track.removeEventListener('ended', interrupted))
      releaseCameraForAr(video, stream)
      stream = undefined
    }
    const fail = (message: string) => {
      if (disposed || failed) return
      failed = true
      window.clearTimeout(startTimeout)
      requestRef.current?.abort()
      stop()
      setState({ status: 'error', message })
      toast.error(message)
    }
    const interrupted = () => fail('Camera đã ngắt kết nối. Vui lòng mở lại camera hoặc chọn ảnh từ thư viện.')
    const videoError = () => fail('Không thể hiển thị hình ảnh từ camera. Vui lòng mở lại camera hoặc chọn ảnh từ thư viện.')
    const startTimeout = window.setTimeout(() => fail('Mở camera quá lâu. Camera có thể vẫn đang được trình xem AR sử dụng. Hãy đóng AR rồi bấm Quay lại camera.'), 15_000)
    stopForArRef.current = () => {
      failed = true
      window.clearTimeout(startTimeout)
      requestRef.current?.abort()
      stop()
    }
    async function start() {
      try {
        checkCameraSupport()
      } catch (error) {
        fail(error instanceof Error ? error.message : cameraErrorMessage(error))
        return
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia(CAMERA_CONSTRAINTS)
        if (disposed || failed) { stop(); return }
        if (!video) { stop(); return }
        stream.getVideoTracks().forEach((track) => track.addEventListener('ended', interrupted))
        video.srcObject = stream
        await video.play()
        if (!disposed && !failed) {
          window.clearTimeout(startTimeout)
          setState({ status: 'ready' })
        }
      } catch (error) {
        fail(cameraErrorMessage(error))
      }
    }
    video?.addEventListener('error', videoError)
    void start()
    return () => {
      disposed = true
      window.clearTimeout(startTimeout)
      stopForArRef.current = null
      requestRef.current?.abort()
      video?.removeEventListener('error', videoError)
      stream?.getVideoTracks().forEach((track) => track.removeEventListener('ended', interrupted))
      stop()
      if (video) video.srcObject = null
    }
  }, [attempt])

  useEffect(() => {
    const handoff = createCameraArHandoff({
      stopCamera: () => {
        stopForArRef.current?.()
        setState({ status: 'ar-paused' })
      },
      resumeCamera: () => {
        setState({ status: 'starting' })
        setAttempt((current) => current + 1)
      },
      isVisible: () => !document.hidden,
      onChange: setArPhase,
      log: import.meta.env.DEV ? (step) => console.info('[SportSnap AR]', step) : undefined,
    })
    arHandoffRef.current = handoff
    const visibility = () => handoff.visibilityChanged(document.hidden)
    const focus = () => handoff.focused()
    const blur = () => handoff.blurred()
    document.addEventListener('visibilitychange', visibility)
    window.addEventListener('focus', focus)
    window.addEventListener('blur', blur)
    return () => {
      handoff.dispose()
      arHandoffRef.current = null
      document.removeEventListener('visibilitychange', visibility)
      window.removeEventListener('focus', focus)
      window.removeEventListener('blur', blur)
    }
  }, [])

  useEffect(() => {
    // Passive effects run after React has removed the previous viewer and cleaned it up.
    if (arPhase === 'releasing') arHandoffRef.current?.overlayRemoved()
    else if (arPhase === 'restoring') arHandoffRef.current?.dialogRemoved()
  }, [arPhase])

  async function scan() {
    if (busyRef.current || state.status !== 'ready' || arPhase !== 'camera' || !videoRef.current) return
    busyRef.current = true
    onReset()
    setScanError(null)
    const controller = new AbortController()
    requestRef.current = controller
    setState({ status: 'capturing', count: 0 })
    try {
      const frames = await captureFrames(videoRef.current, controller.signal, (count) => {
        if (!controller.signal.aborted) setState({ status: 'capturing', count })
      })
      controller.signal.throwIfAborted()
      setState({ status: 'sending' })
      const result = await scanFrames(frames, controller.signal)
      if (!controller.signal.aborted) {
        setState({ status: 'ready' })
        onResult(result, selectBestFrame(frames, result))
      }
    } catch (error) {
      if (controller.signal.aborted) return
      const message = error instanceof Error ? error.message : 'Chưa thể quét khung hình. Vui lòng thử lại.'
      setState({ status: 'ready' })
      toast.error(message)
      setScanError(message)
    } finally {
      busyRef.current = false
    }
  }

  const scanning = state.status === 'capturing' || state.status === 'sending'
  const arAsset = getCameraOverlayAsset(result, autoOverlay && arPhase === 'camera' && state.status === 'ready' && !scanning, sports3d)
  const dialogAvailability = result ? getArAvailability(result.label, result.is_uncertain, sports3d) : null
  const statusText = state.status === 'capturing' ? `Đang quét: ${state.count}/4…`
    : state.status === 'sending' ? 'Đang nhận diện khung hình…'
      : state.status === 'starting' ? 'Đang mở camera…'
        : state.status === 'ar-paused' ? 'Camera đã nhường cho trình xem AR.' : 'Camera đã sẵn sàng'

  return (
    <div>
      <div ref={previewRef} className="relative aspect-[4/3] min-h-80 w-full overflow-hidden rounded-xl bg-black">
        <video
          ref={videoRef} playsInline muted autoPlay aria-label="Camera trực tiếp"
          aria-describedby={state.status !== 'error' ? guideId : undefined}
          className="h-full w-full object-contain object-center"
          onCanPlay={() => setState((current) => current.status === 'starting' ? { status: 'ready' } : current)}
        />
        {state.status === 'starting' && !arAsset && <Skeleton className="absolute inset-0 h-full w-full" />}
        {overlay && !arAsset && state.status !== 'starting' && state.status !== 'error' && (
          <div
            aria-hidden="true"
            className="court-box pointer-events-none absolute"
            style={{
              left: overlay.left, top: overlay.top, width: overlay.size, height: overlay.size,
              boxShadow: '0 0 0 100vmax rgb(0 0 0 / 0.38)',
            }}
          />
        )}
        {arAsset && result && <CameraArOverlay key={`${result.label}:${result.confidence}`} label={result.label}
          confidence={result.confidence} asset={arAsset} cameraReady={state.status === 'ready'}
          onOpenAr={() => arHandoffRef.current?.begin()} onRescan={() => void scan()} />}
        {state.status === 'error' && !arAsset && (
          <div role="alert" className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-card/95 px-6 text-center">
            <TriangleAlert className="shrink-0 text-destructive" aria-hidden="true" />
            <p className="text-sm leading-relaxed">{state.message}</p>
          </div>
        )}
      </div>
      {state.status === 'error' && arAsset && <p role="alert" className="mt-3 text-sm text-destructive">{state.message}</p>}
      {arPhase === 'releasing' && <p role="status" className="mt-3 text-sm text-muted-foreground">Đang nhả camera và mở trình xem AR…</p>}
      {state.status !== 'error' && <>
        <p id={guideId} className="mt-3 text-sm leading-relaxed text-muted-foreground">
          Đưa vật thể vào giữa khung vuông, chiếm phần lớn khung hình. Tránh quay lại màn hình.
        </p>
        <div className="mt-2 text-sm font-medium" role="status" aria-live="polite">
          {statusText}
          {state.status === 'capturing' && (
            <div className="mt-2 grid grid-cols-4 gap-1.5" aria-hidden="true">
              {[1, 2, 3, 4].map((frame) => <span key={frame} className={`h-1.5 rounded-full transition-colors duration-150 ${frame <= state.count ? 'bg-primary' : 'bg-muted'}`} />)}
            </div>
          )}
        </div>
      </>}
      {state.status === 'ar-paused' || arPhase !== 'camera' ? (
        <Button ref={returnFocusRef} className="mt-4 w-full" variant="outline" onClick={() => arHandoffRef.current?.close()}>
          <Camera size={18} aria-hidden="true" />Quay lại camera
        </Button>
      ) : state.status === 'error' ? (
        <Button ref={returnFocusRef} className="mt-4 w-full" variant="outline" onClick={() => {
          setScanError(null)
          setState({ status: 'starting' })
          setAttempt((current) => current + 1)
        }}><Camera size={18} aria-hidden="true" />{result ? 'Quay lại camera' : 'Thử mở lại camera'}</Button>
      ) : (
        <Button ref={returnFocusRef} className="mt-4 min-h-14 w-full text-base font-semibold" disabled={state.status !== 'ready'} onClick={() => { setScanError(null); void scan() }}>
          <ScanLine size={18} aria-hidden="true" />{scanning ? statusText : 'Quét đa khung hình'}
        </Button>
      )}
      {scanError && <p role="alert" className="mt-3 text-sm text-destructive">{scanError}</p>}
      <p className="mt-3 text-center text-xs text-muted-foreground">Giữ máy yên trong lúc chụp 4 khung hình liên tiếp.</p>
      {arPhase === 'dialog' && result && dialogAvailability?.enabled && <SportArDialog
        label={result.label} confidence={result.confidence} asset={dialogAvailability.asset}
        returnFocusRef={returnFocusRef} onClose={() => arHandoffRef.current?.close()}
        onArReturn={() => arHandoffRef.current?.close()} />}
    </div>
  )
}
