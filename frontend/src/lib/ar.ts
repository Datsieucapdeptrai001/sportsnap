export interface ArAsset { glb: string; usdz?: string }

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
