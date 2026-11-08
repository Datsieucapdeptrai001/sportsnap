export interface ArAsset { glb: string; usdz?: string }

export const AR_VIEWER_ATTRIBUTES = {
  ar: true,
  'ar-modes': 'webxr scene-viewer quick-look',
  'ar-placement': 'floor',
  'ar-scale': 'auto',
  'camera-controls': true,
  'shadow-intensity': '1',
  'environment-image': 'neutral',
  loading: 'lazy',
} as const

export type CameraArPhase = 'camera' | 'releasing' | 'dialog' | 'restoring'
export const CAMERA_AR_RELEASE_MS = 400

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

// React acknowledges each viewer's removal after its DOM and effect cleanup.
// Only open a dialog after that acknowledgement and the camera release delay.
export function createCameraArHandoff(options: {
  stopCamera: () => void
  resumeCamera: () => void
  isVisible: () => boolean
  onChange: (phase: CameraArPhase) => void
  log?: (step: string) => void
}) {
  let phase: CameraArPhase = 'camera'
  let timeout: ReturnType<typeof setTimeout> | undefined
  let disposed = false
  let leftPage = false
  let settled = false
  const clear = () => { clearTimeout(timeout); timeout = undefined }
  const change = (next: CameraArPhase) => { phase = next; options.onChange(next) }
  const settle = () => {
    if (disposed || !settled || !options.isVisible()) return
    if (phase === 'releasing') {
      settled = false
      leftPage = false
      options.log?.('open shared AR dialog')
      change('dialog')
    } else if (phase === 'restoring') {
      settled = false
      options.log?.('resume camera')
      change('camera')
      options.resumeCamera()
    }
  }
  const close = () => {
    if (disposed || phase === 'camera' || phase === 'restoring') return
    clear()
    settled = false
    leftPage = false
    change('restoring')
  }
  const returned = () => {
    if (disposed || !options.isVisible()) return
    if (phase === 'dialog' && leftPage) close()
    else settle()
  }
  return {
    begin(): void {
      if (disposed || phase !== 'camera') return
      options.stopCamera()
      options.log?.('stop camera: tracks stopped, video paused, srcObject cleared')
      settled = false
      change('releasing')
    },
    overlayRemoved(): void {
      if (disposed || phase !== 'releasing' || timeout !== undefined || settled) return
      options.log?.('unmount overlay model-viewer')
      timeout = setTimeout(() => { timeout = undefined; settled = true; settle() }, CAMERA_AR_RELEASE_MS)
    },
    dialogRemoved(): void {
      if (disposed || phase !== 'restoring' || timeout !== undefined || settled) return
      options.log?.('unmount shared AR dialog')
      timeout = setTimeout(() => { timeout = undefined; settled = true; settle() }, CAMERA_AR_RELEASE_MS)
    },
    visibilityChanged(hidden: boolean): void {
      if (disposed) return
      if (hidden && phase === 'dialog') leftPage = true
      else if (!hidden) returned()
    },
    blurred(): void { if (!disposed && phase === 'dialog') leftPage = true },
    focused: returned,
    close,
    dispose(): void { disposed = true; clear() },
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
