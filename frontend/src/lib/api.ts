export type PreprocessMode = 'mobilenet_v2' | 'resnet50' | 'none'

export interface HealthResponse {
  status: 'ok'
  model_loaded: boolean
  num_classes: number
  preprocess: PreprocessMode
  reason?: 'model_missing' | 'model_load_failed'
}

export interface ModelInfo {
  id: string
  name: string
  description: string
  preprocess: PreprocessMode
  num_classes: number
  size_mb: number
  active: boolean
}

export interface ModelsListResponse {
  active_model_id: string | null
  models: ModelInfo[]
}

export interface SelectModelResponse {
  active_model_id: string
  model: ModelInfo
}

export interface ModelComparisonItem {
  id: string
  name: string
  preprocess: PreprocessMode
  prediction: Prediction
}

export interface ModelComparisonResponse {
  results: ModelComparisonItem[]
}

const DEV_TOKEN_KEY = 'sportdev_token'

export function getDevToken(): string | null {
  try {
    return sessionStorage.getItem(DEV_TOKEN_KEY) || localStorage.getItem(DEV_TOKEN_KEY)
  } catch {
    return null
  }
}

export function setDevToken(token: string | null): void {
  try {
    if (token) {
      sessionStorage.setItem(DEV_TOKEN_KEY, token)
      localStorage.setItem(DEV_TOKEN_KEY, token)
    } else {
      sessionStorage.removeItem(DEV_TOKEN_KEY)
      localStorage.removeItem(DEV_TOKEN_KEY)
    }
  } catch {
    // Ignore storage errors in restrictive environments
  }
}

export function isDevAuthenticated(): boolean {
  return Boolean(getDevToken())
}

export function authHeaders(): Record<string, string> {
  const token = getDevToken()
  return token ? { 'X-Dev-Token': token } : {}
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
  gradcam_unsupported: 'Mô hình này chưa hỗ trợ bản đồ vùng chú ý.',
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

export interface Explanation extends Prediction { overlay_png_base64: string }

export async function explainImage(image: Blob, signal?: AbortSignal): Promise<Explanation> {
  const body = new FormData()
  body.append('file', image, image instanceof File ? image.name : 'frame.jpg')
  return postImages<Explanation>('/api/explain', body, signal)
}

export interface ExperimentModel {
  name: string; strategy: string; accuracy: number | null; val_accuracy: number | null
  macro_f1: number | null; params_m: number | null; size_mb: number | null; latency_ms: number | null
}
export interface SplitExperiment {
  split: string; count: number; accuracy: number; macro_f1: number; labels: string[]
  confusion_matrix: number[][]; top_confusions: { true: string; pred: string; count: number }[]
}
export interface Insights {
  models: ExperimentModel[]; selected_model: string; splits: SplitExperiment[]
  confusion_matrix_image: string | null
  gradcam_gallery: { image: string; true: string; pred: string; note: string }[]
  ablation?: { name: string; accuracy: number | null; delta: number | null }[] | null
  sources: Record<string, string>; notes: string[]
}

export async function getInsights(signal?: AbortSignal): Promise<Insights> {
  try {
    const response = await fetch('/api/insights', {
      headers: { ...authHeaders() },
      signal,
    })
    if (!response.ok) throw new Error('Không thể tải dữ liệu thí nghiệm. Vui lòng thử lại.')
    return await response.json() as Insights
  } catch (error) {
    if (signal?.aborted) throw error
    throw new Error('Không thể tải dữ liệu thí nghiệm. Kiểm tra kết nối và thử lại.', { cause: error })
  }
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

export async function getModels(signal?: AbortSignal): Promise<ModelsListResponse> {
  let response: Response
  try {
    response = await fetch('/api/models', {
      headers: { ...authHeaders() },
      signal,
    })
  } catch (error) {
    if (signal?.aborted) throw error
    throw new Error('Không thể tải danh sách mô hình. Vui lòng thử lại.', { cause: error })
  }
  if (!response.ok) throw new Error('Không thể tải danh sách mô hình. Vui lòng thử lại.')
  return await response.json() as ModelsListResponse
}

export async function selectModel(modelId: string, signal?: AbortSignal): Promise<SelectModelResponse> {
  let response: Response
  try {
    response = await fetch('/api/models/select', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ model_id: modelId }),
      signal,
    })
  } catch (error) {
    if (signal?.aborted) throw error
    throw new Error('Không thể kết nối khi đổi mô hình. Vui lòng thử lại.', { cause: error })
  }
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null)
    const detail = payload && typeof payload === 'object' && 'error' in payload ? payload.error : null
    const message = detail && typeof detail === 'object' && 'message' in detail && typeof detail.message === 'string'
      ? detail.message
      : 'Không thể chuyển mô hình lúc này.'
    throw new Error(message)
  }
  return await response.json() as SelectModelResponse
}

export async function compareModels(image: Blob, signal?: AbortSignal): Promise<ModelComparisonResponse> {
  const body = new FormData()
  body.append('file', image, image instanceof File ? image.name : 'frame.jpg')
  let response: Response
  try {
    response = await fetch('/api/models/compare', {
      method: 'POST',
      headers: { ...authHeaders() },
      body,
      signal,
    })
  } catch (error) {
    if (signal?.aborted) throw error
    throw new Error('Không thể kết nối khi so sánh các mô hình. Vui lòng thử lại.', { cause: error })
  }
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null)
    const detail = payload && typeof payload === 'object' && 'error' in payload ? payload.error : null
    const code = detail && typeof detail === 'object' && 'code' in detail ? detail.code : null
    if (code === 'file_too_large' || response.status === 413) {
      throw new Error('Ảnh vượt quá giới hạn dung lượng của hệ thống. Vui lòng chọn ảnh nhỏ hơn.')
    }
    throw new Error(typeof code === 'string' && errorMessages[code]
      ? errorMessages[code]
      : 'Chưa thể so sánh các mô hình lúc này. Vui lòng thử lại.')
  }
  return await response.json() as ModelComparisonResponse
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
  files_removed?: boolean
}

export type BulkSort = 'confidence_asc' | 'confidence_desc' | 'filename'

export interface BulkResultItem extends BulkItem { index: number }

export interface BulkResultsQuery {
  label: string
  uncertain: boolean
  sort: BulkSort
  offset: number
  limit: number
}

export interface BulkResults {
  items: BulkResultItem[]
  total: number
  offset: number
  limit: number
  summary: Pick<BulkStatus, 'total' | 'processed' | 'uncertain' | 'errors' | 'counts'>
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

async function bulkRequest(jobId: string, method: 'GET' | 'DELETE', signal?: AbortSignal, suffix = ''): Promise<Response> {
  let response: Response
  try {
    response = await fetch(`/api/bulk/${encodeURIComponent(jobId)}${suffix}`, { method, signal })
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
  const response = await bulkRequest(jobId, 'GET', signal, '/download')
  try { return await response.blob() }
  catch (error) {
    if (signal?.aborted) throw error
    throw new Error('Không thể tải ZIP. Vui lòng kiểm tra mạng và thử lại.', { cause: error })
  }
}

export async function getBulkResults(jobId: string, query: BulkResultsQuery, signal?: AbortSignal): Promise<BulkResults> {
  const params = new URLSearchParams({
    label: query.label, uncertain: String(query.uncertain), sort: query.sort,
    offset: String(query.offset), limit: String(query.limit),
  })
  const response = await bulkRequest(jobId, 'GET', signal, `/results?${params}`)
  try { return await response.json() as BulkResults }
  catch (error) { throw new Error('Không đọc được kết quả phân loại. Vui lòng thử lại.', { cause: error }) }
}

function bulkImageUrl(jobId: string, index: number, kind: 'thumb' | 'image'): string {
  if (!Number.isInteger(index) || index < 0) throw new Error('Chỉ số ảnh không hợp lệ.')
  return `/api/bulk/${encodeURIComponent(jobId)}/${kind}/${index}`
}

export const getBulkThumbnailUrl = (jobId: string, index: number): string => bulkImageUrl(jobId, index, 'thumb')
export const getBulkImageUrl = (jobId: string, index: number): string => bulkImageUrl(jobId, index, 'image')

export interface LibraryStats {
  total_images: number
  total_dup_groups: number
  human_labels: number
  index_size: number
  by_status: Record<string, number>
  by_label: Record<string, number>
}

export interface LibraryJob {
  id: string
  type: string
  state: 'queued' | 'running' | 'done' | 'error'
  progress: number
  message: string | null
  error: string | null
}

export interface LibrarySearchItem {
  image_id: number
  filename: string
  path: string
  thumb_url: string
  file_url: string
  width: number
  height: number
  taken_at: string | null
  label: string
  label_source: 'model' | 'human'
  top1_label: string
  top1_prob: number
  calibrated_prob: number | null
  status: 'auto' | 'review' | 'unknown'
  sharpness: number | null
  exposure: number | null
  similarity: number | null
}

export interface LibrarySearchResponse {
  items: LibrarySearchItem[]
  total: number
  expanded_query: string
}

export interface DedupSummary {
  total_images: number
  num_groups: number
  duplicate_images: number
  archived_candidates: number
  reduction_rate: number
}

export interface DedupMember {
  image_id: number
  filename: string
  thumb_url: string
  width: number
  height: number
  label: string
  confidence: number
  score_total: number
  score_sharpness: number
  score_exposure: number
  score_conf: number
  is_best: boolean
  user_decision: 'keep' | 'archive' | null
}

export interface DedupGroup {
  group_id: number
  created_at: string
  members: DedupMember[]
}

export interface ReviewItem {
  image_id: number
  filename: string
  thumb_url: string
  label: string
  label_source: 'model' | 'human'
  top1_label: string
  top1_prob: number
  calibrated_prob: number | null
  status: 'auto' | 'review' | 'unknown'
}

export interface ModelVersionInfo {
  version: string
  parent: string | null
  created_at: string
  train_set_hash: string | null
  n_corrections_used: number
  metrics: Record<string, number | string>
  temperature: number
  tau_high: number | null
  tau_low: number | null
  preprocess: string
  backbone: string
  is_active: boolean
}

async function libraryJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null)
    const detail = payload && typeof payload === 'object' && 'error' in payload ? payload.error : null
    const message = detail && typeof detail === 'object' && 'message' in detail && typeof detail.message === 'string'
      ? detail.message
      : 'Yêu cầu thất bại. Vui lòng thử lại.'
    throw new Error(message)
  }
  return await response.json() as T
}

export const getLibraryStats = (signal?: AbortSignal) =>
  libraryJson<LibraryStats>('/api/library/stats', { signal })

export const ingestLibraryFolder = (folder: string) =>
  libraryJson<{ job_id: string }>('/api/library/ingest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ folder }),
  })

export const ingestLibraryFiles = (files: File[]) => {
  const body = new FormData()
  files.forEach((f) => body.append('files', f))
  return libraryJson<{ job_id: string }>('/api/library/ingest/upload', { method: 'POST', body })
}

export const getLibraryJob = (jobId: string, signal?: AbortSignal) =>
  libraryJson<LibraryJob>(`/api/library/jobs/${encodeURIComponent(jobId)}`, { signal })

export const searchLibrary = (params: {
  q?: string; label?: string; status?: string; source?: string; minConf?: number; limit?: number
}, signal?: AbortSignal) => {
  const query = new URLSearchParams()
  if (params.q) query.set('q', params.q)
  if (params.label) query.set('label', params.label)
  if (params.status) query.set('status', params.status)
  if (params.source) query.set('source', params.source)
  if (params.minConf !== undefined) query.set('min_conf', String(params.minConf))
  query.set('limit', String(params.limit ?? 36))
  return libraryJson<LibrarySearchResponse>(`/api/library/search?${query}`, { signal })
}

export const searchSimilarById = (imageId: number, k = 24) =>
  libraryJson<{ items: LibrarySearchItem[] }>(`/api/library/search/similar?image_id=${imageId}&k=${k}`, {
    method: 'POST',
  })

export const searchSimilarByFile = (file: Blob, k = 24) => {
  const body = new FormData()
  body.append('file', file, file instanceof File ? file.name : 'query.jpg')
  return libraryJson<{ items: LibrarySearchItem[] }>(`/api/library/search/similar?k=${k}`, {
    method: 'POST',
    body,
  })
}

export const runLibraryDedup = (phashThreshold = 8, clipThreshold = 0.92) =>
  libraryJson<DedupSummary>(
    `/api/library/dedup/run?phash_threshold=${phashThreshold}&clip_threshold=${clipThreshold}`,
    { method: 'POST' },
  )

export const getLibraryDedupGroups = (signal?: AbortSignal) =>
  libraryJson<{ groups: DedupGroup[] }>('/api/library/dedup/groups', { signal })

export const decideLibraryDedupGroup = (groupId: number, payload: { best_image_id?: number; keep_all?: boolean }) =>
  libraryJson<DedupGroup>(`/api/library/dedup/${groupId}/decision`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

export const getLibraryReviewQueue = (includeAll = false, signal?: AbortSignal) =>
  libraryJson<{ items: ReviewItem[]; labels: string[] }>(
    `/api/library/review?include_all=${includeAll}`,
    { signal },
  )

export const setLibraryImageLabel = (imageId: number, label: string) =>
  libraryJson<{ image_id: number; label: string; source: 'human' }>(
    `/api/library/images/${imageId}/label`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label }),
    },
  )

export const deleteLibraryImage = (imageId: number) =>
  libraryJson<{ deleted: boolean; image_id: number }>(
    `/api/library/images/${imageId}`,
    { method: 'DELETE' },
  )

export const triggerLibraryRetrain = (epochs = 3, activate = true) =>
  libraryJson<{ job_id: string }>('/api/library/retrain', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ epochs, activate }),
  })

export const getLibraryModelVersions = (signal?: AbortSignal) =>
  libraryJson<{ versions: ModelVersionInfo[] }>('/api/library/models/versions', { signal })

export const promoteLibraryModelVersion = (version: string) =>
  libraryJson<{ active_version: string; versions: ModelVersionInfo[] }>(
    `/api/library/models/${encodeURIComponent(version)}/promote`,
    { method: 'POST' },
  )
