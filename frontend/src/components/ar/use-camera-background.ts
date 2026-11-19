import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { CAMERA_AR_RELEASE_MS } from '../../lib/ar'
import { cameraErrorMessage, shouldRetryCamera } from '../../lib/interactive-ar/camera'

function releaseStream(stream: MediaStream | null, video: HTMLVideoElement | null): void {
  stream?.getTracks().forEach((track) => track.stop())
  if (video) {
    video.pause()
    video.srcObject = null
  }
}

/**
 * Rear-camera video behind an interactive AR game.
 * - Starts automatically; falls back silently to the virtual background when the camera
 *   is unavailable, denied or the page is not a secure context.
 * - Delays startup by CAMERA_AR_RELEASE_MS to prevent camera device collision when handed off
 *   from another camera-using view (e.g. camera scanner).
 * - Always stops the tracks it opened (also when `play()` rejects or the component
 *   unmounts while the permission prompt is still pending).
 */
export function useCameraBackground(videoRef: RefObject<HTMLVideoElement | null>) {
  const [active, setActive] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Insecure pages (http://) and old browsers have no camera API: derive it once, not in an effect.
  const [unsupported] = useState(() => !window.isSecureContext || !navigator.mediaDevices?.getUserMedia)
  const streamRef = useRef<MediaStream | null>(null)
  const pendingRef = useRef(false)
  const aliveRef = useRef(true)

  const start = useCallback(async () => {
    async function requestCamera(isRetry: boolean): Promise<void> {
      if (unsupported || streamRef.current || pendingRef.current) return
      pendingRef.current = true
      let stream: MediaStream | null = null
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        })
        const video = videoRef.current
        if (!aliveRef.current || !video) {
          releaseStream(stream, null)
          return
        }
        streamRef.current = stream
        video.srcObject = stream
        await video.play()
        setActive(true)
        setError(null)
      } catch (err) {
        releaseStream(stream, videoRef.current)
        streamRef.current = null
        if (aliveRef.current) {
          const errorName = err instanceof Error ? err.name : ''
          if (!isRetry && shouldRetryCamera(errorName)) {
            // Only retry for transient camera locking (e.g. scanner still releasing tracks).
            // Permanent errors (NotAllowedError, NotFoundError, etc.) fail immediately without retrying.
            pendingRef.current = false
            window.setTimeout(() => {
              if (aliveRef.current && !streamRef.current) void requestCamera(true)
            }, CAMERA_AR_RELEASE_MS)
            return
          }
          setActive(false)
          setError(cameraErrorMessage(errorName))
        }
      } finally {
        pendingRef.current = false
      }
    }
    await requestCamera(false)
  }, [unsupported, videoRef])

  const stop = useCallback(() => {
    releaseStream(streamRef.current, videoRef.current)
    streamRef.current = null
    setActive(false)
    setError(null)
  }, [videoRef])

  const toggle = useCallback(() => {
    if (streamRef.current) stop()
    else void start()
  }, [start, stop])

  useEffect(() => {
    aliveRef.current = true
    // Wait for the previous camera owner (e.g. camera-scanner) to finish releasing its tracks
    const timer = window.setTimeout(() => { void start() }, CAMERA_AR_RELEASE_MS)
    const video = videoRef.current
    return () => {
      window.clearTimeout(timer)
      aliveRef.current = false
      releaseStream(streamRef.current, video)
      streamRef.current = null
    }
  }, [start, videoRef])

  return {
    active,
    error: unsupported ? 'Camera cần kết nối HTTPS. Bạn vẫn chơi được ở chế độ nền ảo.' : error,
    toggle,
  }
}
