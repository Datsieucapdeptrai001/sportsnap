import { useEffect, useId, useRef, useState } from 'react'
import { Camera, ScanLine, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'
import { scanFrames, type ScanResult } from '../lib/api'
import { CAMERA_CONSTRAINTS, cameraErrorMessage, captureFrames, checkCameraSupport, getCropOverlay } from '../lib/camera'
import { Button } from './ui/button'
import { Skeleton } from './ui/skeleton'
import { selectBestFrame } from '../lib/explain'

type CameraState =
  | { status: 'starting' | 'ready' | 'sending' }
  | { status: 'capturing'; count: number }
  | { status: 'error'; message: string }

export function CameraScanner({ onResult }: { onResult: (result: ScanResult, image: Blob | null) => void }) {
  const guideId = useId()
  const previewRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const requestRef = useRef<AbortController | null>(null)
  const busyRef = useRef(false)
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<CameraState>({ status: 'starting' })
  const [scanError, setScanError] = useState<string | null>(null)
  const [overlay, setOverlay] = useState<ReturnType<typeof getCropOverlay>>(null)

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
    const stop = () => stream?.getTracks().forEach((track) => track.stop())
    const fail = (message: string) => {
      if (disposed) return
      failed = true
      requestRef.current?.abort()
      stop()
      setState({ status: 'error', message })
      toast.error(message)
    }
    const interrupted = () => fail('Camera đã ngắt kết nối. Vui lòng mở lại camera hoặc chọn ảnh từ thư viện.')
    const videoError = () => fail('Không thể hiển thị hình ảnh từ camera. Vui lòng mở lại camera hoặc chọn ảnh từ thư viện.')
    const hidden = () => { if (document.hidden) interrupted() }
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
      } catch (error) {
        fail(cameraErrorMessage(error))
      }
    }
    document.addEventListener('visibilitychange', hidden)
    video?.addEventListener('error', videoError)
    void start()
    return () => {
      disposed = true
      requestRef.current?.abort()
      document.removeEventListener('visibilitychange', hidden)
      video?.removeEventListener('error', videoError)
      stream?.getVideoTracks().forEach((track) => track.removeEventListener('ended', interrupted))
      stop()
      if (video) video.srcObject = null
    }
  }, [attempt])

  async function scan() {
    if (busyRef.current || state.status !== 'ready' || !videoRef.current) return
    busyRef.current = true
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
      if (!controller.signal.aborted) onResult(result, selectBestFrame(frames, result))
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
  const statusText = state.status === 'capturing' ? `Đang quét: ${state.count}/4…`
    : state.status === 'sending' ? 'Đang nhận diện khung hình…'
      : state.status === 'starting' ? 'Đang mở camera…' : 'Camera đã sẵn sàng'

  return (
    <div>
      <div ref={previewRef} className="relative aspect-[4/3] overflow-hidden rounded-xl bg-black">
        <video
          ref={videoRef} playsInline muted autoPlay aria-label="Camera trực tiếp"
          aria-describedby={state.status !== 'error' ? guideId : undefined}
          className="h-full w-full object-contain object-center"
          onCanPlay={() => setState((current) => current.status === 'starting' ? { status: 'ready' } : current)}
        />
        {state.status === 'starting' && <Skeleton className="absolute inset-0 h-full w-full" />}
        {overlay && state.status !== 'starting' && state.status !== 'error' && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute border-2 border-emerald-300"
            style={{
              left: overlay.left, top: overlay.top, width: overlay.size, height: overlay.size,
              boxShadow: '0 0 0 100vmax rgb(0 0 0 / 0.3)',
            }}
          />
        )}
        {state.status === 'error' && (
          <div role="alert" className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-card/95 px-6 text-center">
            <TriangleAlert className="shrink-0 text-destructive" aria-hidden="true" />
            <p className="text-sm leading-relaxed">{state.message}</p>
          </div>
        )}
      </div>
      {state.status !== 'error' && <>
        <p id={guideId} className="mt-3 text-center text-sm leading-relaxed text-muted-foreground">
          Đưa vật thể vào giữa khung vuông, chiếm phần lớn khung hình. Tránh quay lại màn hình.
        </p>
        <div className="mt-3 text-center text-sm text-muted-foreground" role="status" aria-live="polite">
          {statusText}
          {state.status === 'capturing' && (
            <div className="mt-2 flex justify-center gap-2" aria-hidden="true">
              {[1, 2, 3, 4].map((frame) => <span key={frame} className={`h-1.5 w-8 rounded-full ${frame <= state.count ? 'bg-primary' : 'bg-muted'}`} />)}
            </div>
          )}
        </div>
      </>}
      {state.status === 'error' ? (
        <Button className="mt-4 w-full" variant="outline" onClick={() => {
          setScanError(null)
          setState({ status: 'starting' })
          setAttempt((current) => current + 1)
        }}><Camera size={18} aria-hidden="true" />Thử mở lại camera</Button>
      ) : (
        <Button className="mt-4 w-full" disabled={state.status !== 'ready'} onClick={() => { setScanError(null); void scan() }}>
          <ScanLine size={18} aria-hidden="true" />{scanning ? statusText : 'Quét đa khung hình'}
        </Button>
      )}
      {scanError && <p role="alert" className="mt-3 text-sm text-destructive">{scanError}</p>}
      <p className="mt-3 text-center text-xs text-muted-foreground">Giữ máy ổn định · Chụp 4 khung hình cách nhau khoảng 300 ms</p>
    </div>
  )
}
