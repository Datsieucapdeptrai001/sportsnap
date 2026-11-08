import type { Explanation, ScanResult } from './api'

export type ExplanationState =
  | { status: 'loading' }
  | { status: 'success'; result: Explanation }
  | { status: 'error'; message: string }

export function selectBestFrame(frames: Blob[], result: ScanResult): Blob | null {
  // Prefer agreement with the final label, then highest confidence; retain the
  // exact uploaded frame, not another capture or a re-encoded display image.
  const ranked = result.per_frame.map((prediction, index) => ({ ...prediction, index }))
  ranked.sort((a, b) => Number(b.label === result.label) - Number(a.label === result.label)
    || b.confidence - a.confidence || a.index - b.index)
  return frames[ranked[0]?.index] ?? null
}

export async function loadExplanation(
  image: Blob, signal: AbortSignal, publish: (state: ExplanationState) => void,
  request: (image: Blob, signal: AbortSignal) => Promise<Explanation>,
): Promise<void> {
  if (signal.aborted) return
  publish({ status: 'loading' })
  try {
    const result = await request(image, signal)
    if (!signal.aborted) publish({ status: 'success', result })
  } catch (error) {
    if (!signal.aborted) publish({ status: 'error', message: error instanceof Error ? error.message : 'Không thể tạo bản đồ chú ý. Vui lòng thử lại.' })
  }
}
