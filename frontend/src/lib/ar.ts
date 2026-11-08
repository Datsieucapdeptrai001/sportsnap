export interface ArAsset { glb: string; usdz?: string }

export interface CameraArLaunchState {
  phase: 'idle' | 'launching' | 'away' | 'presenting'
  message: string
}

export const AR_LAUNCH_FAILURE = 'Chưa mở được AR. Android có thể cần cài hoặc cập nhật Google Play Services for AR và ứng dụng Google. Mạng chậm có thể làm trình xem chưa tải được mô hình; iOS có thể đang tạo USDZ. Hãy kiểm tra mạng, quyền camera rồi bấm Thử lại AR.'

export function releaseCameraForAr(
  video: Pick<HTMLVideoElement, 'pause' | 'srcObject'> | null,
  stream?: MediaStream,
): void {
  // A cancelled getUserMedia request may resolve after a replacement stream.
  // Stop that stale stream without detaching the replacement from the video.
  const ownsVideo = video && (!video.srcObject || video.srcObject === stream)
  if (ownsVideo) video.pause()
  stream?.getTracks().forEach((track) => track.stop())
  if (ownsVideo) video.srcObject = null
}

// Native viewers do not reliably publish ar-status or reject activateAR().
// Watch page handoff as well, and never await before invoking the gesture callback.
export function createCameraArHandoff(options: {
  stopCamera: () => void
  resumeCamera: () => void
  isVisible: () => boolean
  isFocused: () => boolean
  onChange: (state: CameraArLaunchState) => void
}) {
  let phase: CameraArLaunchState['phase'] = 'idle'
  let timeout: ReturnType<typeof setTimeout> | undefined
  let generation = 0
  let disposed = false
  let lostFocus = false
  let resumePending = false
  const clearWatchdog = () => { clearTimeout(timeout); timeout = undefined }
  const resumeIfVisible = () => {
    if (resumePending && options.isVisible() && !disposed) {
      resumePending = false
      options.resumeCamera()
    }
  }
  const finish = (message = '', force = false) => {
    if (disposed || (phase === 'idle' && !force)) return
    generation++
    clearWatchdog()
    phase = 'idle'
    lostFocus = false
    resumePending = true
    options.onChange({ phase, message })
    resumeIfVisible()
  }
  const returned = () => {
    if (disposed || !options.isVisible()) return
    if (phase === 'away' || (phase === 'launching' && lostFocus)) finish()
    else resumeIfVisible()
  }
  return {
    launch(activate: () => Promise<void>): void {
      if (disposed || phase !== 'idle') return
      const token = ++generation
      phase = 'launching'
      lostFocus = false
      resumePending = false
      options.onChange({ phase, message: '' })
      try {
        options.stopCamera()
        timeout = setTimeout(() => {
          if (disposed || token !== generation || phase !== 'launching') return
          if (!options.isVisible() || !options.isFocused()) {
            phase = 'away'
            options.onChange({ phase, message: '' })
          } else finish(AR_LAUNCH_FAILURE)
        }, 8_000)
        // Keep the actual activateAR call in the same stack as the tap.
        void activate().catch(() => {
          if (!disposed && token === generation) finish(AR_LAUNCH_FAILURE)
        })
      } catch {
        if (token === generation) finish(AR_LAUNCH_FAILURE)
      }
    },
    visibilityChanged(hidden: boolean): void {
      if (disposed) return
      if (hidden && phase === 'launching') {
        phase = 'away'
        clearWatchdog()
        options.onChange({ phase, message: '' })
      } else if (!hidden) returned()
    },
    blurred(): void { if (!disposed && phase === 'launching') lostFocus = true },
    focused: returned,
    status(status: string | undefined): void {
      if (disposed || phase === 'idle') return
      if (status === 'failed') finish(AR_LAUNCH_FAILURE)
      else if (status === 'session-started' || status === 'object-placed') {
        clearWatchdog()
        phase = 'presenting'
        options.onChange({ phase, message: '' })
      } else if (status === 'not-presenting' && phase === 'presenting') finish()
    },
    returnToCamera(): void { finish('', true) },
    dispose(): void { disposed = true; generation++; clearWatchdog() },
  }
}

export function getCameraOverlayAsset(
  result: { label: string; is_uncertain: boolean } | null,
  enabled: boolean,
  assets: Readonly<Partial<Record<string, ArAsset>>>,
): ArAsset | null {
  if (!enabled || !result) return null
  const availability = getArAvailability(result.label, result.is_uncertain, assets)
  return availability.enabled ? availability.asset : null
}

const AUTO_OPEN_AR_KEY = 'sportsnap.auto-open-ar'

export function readAutoOpenArPreference(storage?: Pick<Storage, 'getItem'>): boolean {
  try {
    return (storage ?? globalThis.localStorage)?.getItem(AUTO_OPEN_AR_KEY) !== 'false'
  } catch {
    return true
  }
}

export function saveAutoOpenArPreference(enabled: boolean, storage?: Pick<Storage, 'setItem'>): void {
  try {
    (storage ?? globalThis.localStorage)?.setItem(AUTO_OPEN_AR_KEY, String(enabled))
  } catch {
    // Keep the in-memory choice when storage is unavailable or blocked.
  }
}

export type ArAvailability =
  | { enabled: true; asset: ArAsset; message: '' }
  | { enabled: false; message: string }

export function getArAvailability(
  label: string,
  isUncertain: boolean,
  assets: Readonly<Partial<Record<string, ArAsset>>>,
): ArAvailability {
  const asset = Object.hasOwn(assets, label) ? assets[label] : undefined
  const hasModel = asset !== undefined && /^\/models\/[a-z0-9_]+\.glb$/.test(asset.glb)
  const notes: string[] = []
  if (isUncertain) notes.push('Kết quả chưa chắc chắn nên chưa mở AR')
  if (!hasModel) notes.push('Môn thể thao này chưa có mô hình 3D để mở AR')
  if (notes.length || !asset) return { enabled: false, message: notes.join('. ') }
  return { enabled: true, asset, message: '' }
}

export function modelLoadProgress(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.round(Math.min(1, Math.max(0, value)) * 100)
    : 0
}

export function modelSource(glb: string, retryToken: number): string {
  // model-viewer caches failed GLB loads too; a new URL forces a real retry.
  return retryToken > 0 ? `${glb}?ar-retry=${retryToken}` : glb
}

// Retry a failed import, and share successful/in-flight loads across dialogs.
export function createViewerLoader(importViewer: () => Promise<unknown>): () => Promise<void> {
  let pending: Promise<void> | undefined
  return () => {
    pending ??= Promise.resolve().then(importViewer).then(() => undefined).catch((error: unknown) => {
      pending = undefined
      throw error
    })
    return pending
  }
}
