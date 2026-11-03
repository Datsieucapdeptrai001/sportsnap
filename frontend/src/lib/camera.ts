const MAX_SCAN_BYTES = 1_500_000
// Leave ample room for multipart boundaries and headers with fixed short filenames.
const MULTIPART_RESERVE_BYTES = 16_384

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

function resizeFrame(source: CanvasImageSource, width: number, height: number, maxSide: number): HTMLCanvasElement {
  const scale = Math.min(1, maxSide / Math.max(width, height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width * scale))
  canvas.height = Math.max(1, Math.round(height * scale))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Không thể chụp khung hình trên trình duyệt này. Vui lòng chọn ảnh từ thư viện.')
  try {
    context.drawImage(source, 0, 0, canvas.width, canvas.height)
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
  for (const quality of [0.85, 0.75, 0.65, 0.55]) {
    signal.throwIfAborted()
    const encoded = await Promise.all(frames.map((frame) => jpeg(frame, quality)))
    signal.throwIfAborted()
    if (fits(encoded)) return encoded
  }
  const smaller = frames.map((frame) => resizeFrame(frame, frame.width, frame.height, 512))
  const encoded = await Promise.all(smaller.map((frame) => jpeg(frame, 0.55)))
  signal.throwIfAborted()
  if (fits(encoded)) return encoded
  for (const count of [3, 2]) {
    const reduced = encoded.slice(0, count)
    if (fits(reduced)) return reduced
  }
  throw new Error('Khung hình vẫn vượt quá giới hạn 1,5 MB. Vui lòng thử lại với cảnh ít chi tiết hơn hoặc chọn một ảnh từ thư viện.')
}

function waitBetweenFrames(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted()
    const abort = () => {
      clearTimeout(timer)
      reject(signal.reason)
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort)
      resolve()
    }, 300)
    signal.addEventListener('abort', abort, { once: true })
  })
}

export async function captureFrames(
  video: HTMLVideoElement, signal: AbortSignal, onProgress: (count: number) => void,
): Promise<Blob[]> {
  const frames: HTMLCanvasElement[] = []
  for (let index = 0; index < 4; index++) {
    signal.throwIfAborted()
    if (video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
      throw new Error('Camera chưa có hình ảnh. Vui lòng đợi hoặc mở lại camera.')
    }
    frames.push(resizeFrame(video, video.videoWidth, video.videoHeight, 640))
    onProgress(index + 1)
    if (index < 3) await waitBetweenFrames(signal)
  }
  return compressFrames(frames, signal)
}
