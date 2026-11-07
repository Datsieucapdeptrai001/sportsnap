const MAX_SCAN_BYTES = 1_500_000
// Leave ample room for multipart boundaries and headers with fixed short filenames.
const MULTIPART_RESERVE_BYTES = 16_384
const FRAME_SIDE = 448

export const CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  video: {
    facingMode: { ideal: 'environment' },
    width: { ideal: 1280 },
    height: { ideal: 720 },
  },
  audio: false,
}

export function cameraErrorMessage(error: unknown): string {
  const name = error instanceof DOMException || error instanceof Error ? error.name : ''
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'Quyền truy cập camera bị từ chối. Hãy cho phép camera trong cài đặt trình duyệt hoặc chọn ảnh từ thư viện.'
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return 'Không tìm thấy camera phù hợp trên thiết bị. Vui lòng chọn ảnh từ thư viện.'
  }
  if (name === 'NotReadableError' || name === 'AbortError') {
    return 'Không thể mở camera. Camera có thể đang được ứng dụng khác sử dụng. Vui lòng thử lại.'
  }
  return 'Không thể sử dụng camera lúc này. Vui lòng thử lại hoặc chọn ảnh từ thư viện.'
}

export function checkCameraSupport(): void {
  if (!window.isSecureContext) {
    throw new Error('Camera cần kết nối HTTPS hoặc localhost. Hãy mở ứng dụng qua HTTPS hoặc chọn ảnh từ thư viện.')
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Thiết bị hoặc trình duyệt không hỗ trợ camera. Vui lòng chọn ảnh từ thư viện.')
  }
}

function centerCrop(width: number, height: number): { x: number; y: number; size: number } {
  const size = Math.min(width, height)
  return { x: (width - size) / 2, y: (height - size) / 2, size }
}

export function getCropOverlay(
  videoWidth: number, videoHeight: number, previewWidth: number, previewHeight: number,
): { left: number; top: number; size: number } | null {
  if (![videoWidth, videoHeight, previewWidth, previewHeight].every((value) => Number.isFinite(value) && value > 0)) return null
  // Match the centered object-contain video, including any letterboxing.
  const scale = Math.min(previewWidth / videoWidth, previewHeight / videoHeight)
  const crop = centerCrop(videoWidth, videoHeight)
  return {
    left: (previewWidth - videoWidth * scale) / 2 + crop.x * scale,
    top: (previewHeight - videoHeight * scale) / 2 + crop.y * scale,
    size: crop.size * scale,
  }
}

function captureFrame(video: HTMLVideoElement): HTMLCanvasElement {
  // Use intrinsic video pixels; CSS preview dimensions and transforms do not apply.
  const { x: sx, y: sy, size: side } = centerCrop(video.videoWidth, video.videoHeight)
  const canvas = document.createElement('canvas')
  canvas.width = FRAME_SIDE
  canvas.height = FRAME_SIDE
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Không thể chụp khung hình trên trình duyệt này. Vui lòng chọn ảnh từ thư viện.')
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  try {
    context.drawImage(video, sx, sy, side, side, 0, 0, FRAME_SIDE, FRAME_SIDE)
  } catch (error) {
    throw new Error('Không thể đọc khung hình từ camera. Vui lòng mở lại camera hoặc chọn ảnh từ thư viện.', { cause: error })
  }
  return canvas
}

function jpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const message = 'Không thể nén khung hình. Vui lòng thử lại hoặc chọn ảnh từ thư viện.'
    try {
      canvas.toBlob((blob) => {
        if (blob && blob.type === 'image/jpeg') resolve(blob)
        else reject(new Error(message))
      }, 'image/jpeg', quality)
    } catch (error) {
      reject(new Error(message, { cause: error }))
    }
  })
}

export async function compressFrames(frames: HTMLCanvasElement[], signal: AbortSignal): Promise<Blob[]> {
  const fits = (blobs: Blob[]) => blobs.reduce((sum, blob) => sum + blob.size, 0) + MULTIPART_RESERVE_BYTES < MAX_SCAN_BYTES
  let encoded: Blob[] = []
  for (const quality of [0.95, 0.90, 0.85]) {
    signal.throwIfAborted()
    encoded = await Promise.all(frames.map((frame) => jpeg(frame, quality)))
    signal.throwIfAborted()
    if (fits(encoded)) return encoded
  }
  for (let count = encoded.length - 1; count >= 2; count--) {
    const reduced = encoded.slice(0, count)
    if (fits(reduced)) return reduced
  }
  throw new Error('Khung hình vẫn vượt quá giới hạn 1,5 MB. Vui lòng thử lại với cảnh ít chi tiết hơn hoặc chọn một ảnh từ thư viện.')
}

function wait(signal: AbortSignal, milliseconds: number): Promise<void> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted()
    const abort = () => {
      clearTimeout(timer)
      reject(signal.reason)
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort)
      resolve()
    }, milliseconds)
    signal.addEventListener('abort', abort, { once: true })
  })
}

export async function captureFrames(
  video: HTMLVideoElement, signal: AbortSignal, onProgress: (count: number) => void,
): Promise<Blob[]> {
  signal.throwIfAborted()
  // Wait up to five seconds for decoded video pixels, then discard early frames
  // while exposure and focus settle before taking the first snapshot.
  for (let attempt = 0; video.readyState < 2 || !video.videoWidth || !video.videoHeight; attempt++) {
    if (attempt >= 100) throw new Error('Camera chưa có hình ảnh. Vui lòng đợi hoặc mở lại camera.')
    await wait(signal, 50)
  }
  await wait(signal, 500)
  const frames: HTMLCanvasElement[] = []
  for (let index = 0; index < 4; index++) {
    signal.throwIfAborted()
    if (video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
      throw new Error('Camera chưa có hình ảnh. Vui lòng đợi hoặc mở lại camera.')
    }
    frames.push(captureFrame(video))
    onProgress(index + 1)
    if (index < 3) await wait(signal, 300)
  }
  return compressFrames(frames, signal)
}
