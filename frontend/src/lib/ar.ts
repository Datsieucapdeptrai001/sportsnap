export interface ArAsset { glb: string; usdz?: string }

export interface ArAutoOpenRequest {
  resultId: number
  source: 'camera' | 'image'
  enabled: boolean
}

export function shouldAutoOpenAr(
  request: ArAutoOpenRequest | undefined,
  lastOpenedResultId: number | null,
  dialogOpen: boolean,
  label: string,
  isUncertain: boolean,
  assets: Readonly<Partial<Record<string, ArAsset>>>,
): boolean {
  return request !== undefined && request.source === 'camera' && request.enabled
    && request.resultId !== lastOpenedResultId && !dialogOpen
    && getArAvailability(label, isUncertain, assets).enabled
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
