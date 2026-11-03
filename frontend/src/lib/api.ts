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

const errorMessages: Record<string, string> = {
  bad_request: 'Không thể gửi ảnh. Vui lòng chọn lại ảnh và thử lại.',
  unsupported_format: 'Chỉ hỗ trợ ảnh JPG, JPEG, PNG hoặc WebP. Vui lòng chọn ảnh khác.',
  invalid_image: 'Không đọc được ảnh này. Ảnh có thể bị hỏng; vui lòng chọn ảnh khác.',
  model_not_loaded: 'Mô hình chưa sẵn sàng. Vui lòng thử lại sau.',
  internal_error: 'Chưa thể nhận diện ảnh. Vui lòng thử lại sau.',
}

export async function predictImage(file: File, signal?: AbortSignal): Promise<Prediction> {
  const body = new FormData()
  body.append('file', file)

  let response: Response
  try {
    response = await fetch('/api/predict', { method: 'POST', body, signal })
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
    return await response.json() as Prediction
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
