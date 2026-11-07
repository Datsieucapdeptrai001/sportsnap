export interface HealthResponse {
  status: 'ok'
  model_loaded: boolean
  num_classes: number
  preprocess: 'mobilenet_v2'
  reason?: 'model_missing' | 'model_load_failed'
}

export async function getHealth(signal?: AbortSignal): Promise<HealthResponse> {
  const response = await fetch('/api/health', { signal })
  if (!response.ok) {
    throw new Error('Không thể kiểm tra trạng thái hệ thống. Vui lòng thử lại.')
  }
  return response.json() as Promise<HealthResponse>
}

export interface ClassConfidence {
  label: string
  confidence: number
}

export interface Prediction extends ClassConfidence {
  top3: ClassConfidence[]
  is_uncertain: boolean
  threshold: number
  latency_ms: number
}

export type FramePrediction = ClassConfidence

export interface ScanResult extends Prediction {
  per_frame: FramePrediction[]
  agreement: number
}

const errorMessages: Record<string, string> = {
  bad_request: 'Không thể gửi ảnh. Vui lòng chọn lại ảnh và thử lại.',
  unsupported_format: 'Chỉ hỗ trợ ảnh JPG, JPEG, PNG hoặc WebP. Vui lòng chọn ảnh khác.',
  invalid_image: 'Không đọc được ảnh này. Ảnh có thể bị hỏng; vui lòng chọn ảnh khác.',
  model_not_loaded: 'Mô hình chưa sẵn sàng. Vui lòng thử lại sau.',
  internal_error: 'Chưa thể nhận diện ảnh. Vui lòng thử lại sau.',
  too_many_files: 'Số tệp vượt giới hạn mỗi lượt. Vui lòng chọn ít tệp hơn.',
  job_not_ready: 'Lượt phân loại chưa sẵn sàng hoặc hệ thống đang đủ lượt chờ/chạy. Vui lòng đợi.',
  job_not_found: 'Không tìm thấy lượt phân loại. Vui lòng gửi lại ảnh.',
  job_expired: 'Lượt phân loại đã hết hạn. Vui lòng gửi lại ảnh.',
}

export async function predictImage(file: File, signal?: AbortSignal): Promise<Prediction> {
  const body = new FormData()
  body.append('file', file)
  return postImages<Prediction>('/api/predict', body, signal)
}

export async function scanFrames(files: Blob[], signal?: AbortSignal): Promise<ScanResult> {
  if (files.length < 2 || files.length > 6) {
    throw new Error('Vui lòng gửi từ 2 đến 6 khung hình để quét.')
  }
  const body = new FormData()
  files.forEach((file, index) => body.append('files', file, `frame-${index + 1}.jpg`))
  return postImages<ScanResult>('/api/scan', body, signal)
}

async function postImages<T extends Prediction>(path: string, body: FormData, signal?: AbortSignal): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, { method: 'POST', body, signal })
  } catch (error) {
    if (signal?.aborted) throw error
    throw new Error('Không thể kết nối. Vui lòng kiểm tra mạng và thử lại.', { cause: error })
  }

  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null)
    const detail = payload && typeof payload === 'object' && 'error' in payload ? payload.error : null
    const code = detail && typeof detail === 'object' && 'code' in detail ? detail.code : null
    // The upload limit is configured by the server, never duplicated in the UI.
    if (code === 'file_too_large' || response.status === 413) {
      throw new Error('Ảnh vượt quá giới hạn dung lượng của hệ thống. Vui lòng chọn ảnh nhỏ hơn.')
    }
    throw new Error(typeof code === 'string' && errorMessages[code]
      ? errorMessages[code]
      : 'Chưa thể nhận diện ảnh. Vui lòng thử lại sau.')
  }

  try {
    return await response.json() as T
  } catch (error) {
    throw new Error('Không đọc được kết quả nhận diện. Vui lòng thử lại.', { cause: error })
  }
}

export async function getClasses(signal?: AbortSignal): Promise<string[]> {
  const response = await fetch('/api/classes', { signal })
  if (!response.ok) throw new Error('Không thể tải danh sách môn thể thao.')
  const result = await response.json() as { classes: string[] }
  return result.classes
}

export type BulkState = 'queued' | 'running' | 'done' | 'error' | 'cancelled'

export interface BulkItem {
  filename: string
  label: string | null
  confidence: number | null
  is_uncertain: boolean
  top3: ClassConfidence[]
  folder: string
  error: string | null
}

export interface BulkStatus {
  status: BulkState
  processed: number
  total: number
  uncertain: number
  errors: number
  counts: Record<string, number>
  items: BulkItem[]
  error: string | null
}

function bulkError(payload: unknown, status: number): Error {
  const detail = payload && typeof payload === 'object' && 'error' in payload ? payload.error : null
  const code = detail && typeof detail === 'object' && 'code' in detail ? detail.code : null
  if (code === 'file_too_large' || (status === 413 && code !== 'too_many_files')) {
    return new Error('Dung lượng tải lên vượt giới hạn hệ thống. Vui lòng chọn ít tệp hơn hoặc tệp nhỏ hơn.')
  }
  return new Error(typeof code === 'string' && errorMessages[code]
    ? errorMessages[code] : 'Không thể thực hiện phân loại hàng loạt. Vui lòng thử lại.')
}

export function createBulkJob(
  files: File[], onProgress: (percent: number) => void, signal?: AbortSignal,
): Promise<{ job_id: string }> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason); return }
    const xhr = new XMLHttpRequest()
    const body = new FormData()
    files.forEach((file) => body.append('files', file))
    const abort = () => { xhr.abort(); reject(signal?.reason ?? new DOMException('Aborted', 'AbortError')) }
    const cleanup = () => signal?.removeEventListener('abort', abort)
    xhr.open('POST', '/api/bulk')
    xhr.responseType = 'json'
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round(event.loaded / event.total * 100))
    }
    xhr.onload = () => {
      cleanup()
      if (xhr.status < 200 || xhr.status >= 300) { reject(bulkError(xhr.response, xhr.status)); return }
      const result: unknown = xhr.response
      if (!result || typeof result !== 'object' || !('job_id' in result) || typeof result.job_id !== 'string') {
        reject(new Error('Không đọc được mã lượt phân loại. Vui lòng thử lại.')); return
      }
      onProgress(100)
      resolve({ job_id: result.job_id })
    }
    xhr.onerror = () => { cleanup(); reject(new Error('Không thể kết nối. Vui lòng kiểm tra mạng và thử lại.')) }
    xhr.onabort = () => { cleanup(); reject(signal?.reason ?? new DOMException('Aborted', 'AbortError')) }
    signal?.addEventListener('abort', abort, { once: true })
    xhr.send(body)
  })
}

async function bulkRequest(jobId: string, method: 'GET' | 'DELETE', signal?: AbortSignal, download = false): Promise<Response> {
  let response: Response
  try {
    response = await fetch(`/api/bulk/${encodeURIComponent(jobId)}${download ? '/download' : ''}`, { method, signal })
  } catch (error) {
    if (signal?.aborted) throw error
    throw new Error('Không thể kết nối. Vui lòng kiểm tra mạng và thử lại.', { cause: error })
  }
  if (!response.ok) throw bulkError(await response.json().catch(() => null), response.status)
  return response
}

async function readBulkStatus(response: Response): Promise<BulkStatus> {
  try { return await response.json() as BulkStatus }
  catch (error) { throw new Error('Không đọc được kết quả phân loại. Vui lòng thử lại.', { cause: error }) }
}

export async function getBulkJob(jobId: string, signal?: AbortSignal): Promise<BulkStatus> {
  return readBulkStatus(await bulkRequest(jobId, 'GET', signal))
}

export async function cancelBulkJob(jobId: string, signal?: AbortSignal): Promise<BulkStatus> {
  return readBulkStatus(await bulkRequest(jobId, 'DELETE', signal))
}

export async function downloadBulkJob(jobId: string, signal?: AbortSignal): Promise<Blob> {
  const response = await bulkRequest(jobId, 'GET', signal, true)
  try { return await response.blob() }
  catch (error) {
    if (signal?.aborted) throw error
    throw new Error('Không thể tải ZIP. Vui lòng kiểm tra mạng và thử lại.', { cause: error })
  }
}
