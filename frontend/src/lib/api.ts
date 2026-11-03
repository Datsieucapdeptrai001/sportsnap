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
