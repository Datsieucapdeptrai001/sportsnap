import { getBulkJob, type BulkResultItem, type BulkResultsQuery, type BulkSort, type BulkState, type BulkStatus } from './api.ts'

export function isBulkTerminal(status: BulkState): boolean {
  return status === 'done' || status === 'error' || status === 'cancelled'
}

export const BULK_PAGE_SIZE = 24

export interface BulkView {
  label: string
  uncertain: boolean
  sort: BulkSort
  page: number
}

export const initialBulkView: BulkView = { label: '', uncertain: false, sort: 'confidence_desc', page: 1 }

export function changeBulkFilters(view: BulkView, change: Partial<Omit<BulkView, 'page'>>): BulkView {
  return { ...view, ...change, page: 1 }
}

export function toggleBulkLabel(view: BulkView, label: string): BulkView {
  return changeBulkFilters(view, { label: view.label === label ? '' : label })
}

export function bulkResultsQuery(view: BulkView): BulkResultsQuery {
  return { label: view.label, uncertain: view.uncertain, sort: view.sort, offset: (Math.max(1, view.page) - 1) * BULK_PAGE_SIZE, limit: BULK_PAGE_SIZE }
}

export function bulkPagination(total: number, requestedPage: number) {
  const pages = Math.max(1, Math.ceil(total / BULK_PAGE_SIZE))
  const page = Math.min(pages, Math.max(1, requestedPage))
  const count = Math.min(5, pages)
  const start = Math.min(Math.max(1, page - 2), pages - count + 1)
  return { page, pages, numbers: Array.from({ length: count }, (_, index) => start + index) }
}

export function moveBulkLightbox(items: Pick<BulkResultItem, 'index'>[], current: number, direction: -1 | 1): number | null {
  if (!items.length) return null
  const position = items.findIndex((item) => item.index === current)
  return items[(position < 0 ? 0 : position + direction + items.length) % items.length].index
}

export function bulkStatusAfterRemoval(previous: BulkStatus | null, removed: BulkStatus): BulkStatus {
  // DELETE also cleans up completed jobs. Preserve their processing outcome.
  return previous?.status === 'done' || previous?.status === 'error'
    ? { ...removed, status: previous.status, error: previous.error }
    : removed
}

interface PollDependencies {
  get: typeof getBulkJob
  schedule: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>
  clear: (timer: ReturnType<typeof setTimeout>) => void
}

export function pollBulkJob(
  jobId: string, onUpdate: (status: BulkStatus) => void, onError: (error: unknown) => void,
  dependencies: PollDependencies = {
    get: getBulkJob,
    schedule: (callback, delay) => setTimeout(callback, delay),
    clear: (timer) => clearTimeout(timer),
  },
): () => void {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  async function poll() {
    try {
      const status = await dependencies.get(jobId, controller.signal)
      if (controller.signal.aborted) return
      onUpdate(status)
      if (!isBulkTerminal(status.status) && !controller.signal.aborted) timer = dependencies.schedule(() => { void poll() }, 1000)
    } catch (error) {
      if (!controller.signal.aborted) onError(error)
    }
  }
  void poll()
  return () => {
    controller.abort()
    if (timer !== undefined) dependencies.clear(timer)
  }
}
