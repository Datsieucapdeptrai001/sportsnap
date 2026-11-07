import { getBulkJob, type BulkItem, type BulkState, type BulkStatus } from './api.ts'

export function isBulkTerminal(status: BulkState): boolean {
  return status === 'done' || status === 'error' || status === 'cancelled'
}

export function filterBulkItems<T extends BulkItem>(items: T[], label: string, uncertainOnly: boolean): T[] {
  return items.filter((item) => (!label || item.label === label) && (!uncertainOnly || item.is_uncertain))
}

export interface BulkPreviewRow extends BulkItem {
  index: number
  file?: File
}

export function pairBulkPreviewItems(items: BulkItem[], files: File[]): BulkPreviewRow[] {
  const archive = files.length === 1 && files[0].name.toLowerCase().endsWith('.zip')
  // Pair before filtering: API preview items retain the submitted file order.
  return items.slice(0, 50).map((item, index) => {
    const file = archive ? undefined : files[index]
    const image = file && (/^image\/(jpeg|png|webp)$/.test(file.type) || /\.(jpe?g|png|webp)$/i.test(file.name))
    return { ...item, index, file: image ? file : undefined }
  })
}

type ObjectUrls = Pick<typeof URL, 'createObjectURL' | 'revokeObjectURL'>

export function createBulkPreviewUrls(objectUrls: ObjectUrls = URL) {
  const entries = new Map<number, { file: File; url: string }>()
  function release(index: number, entry: { file: File; url: string }) {
    // A stale effect cleanup must never release a replacement file's URL.
    if (entries.get(index) !== entry) return
    objectUrls.revokeObjectURL(entry.url)
    entries.delete(index)
  }
  return {
    acquire(index: number, file: File) {
      let entry = entries.get(index)
      if (entry && entry.file !== file) { release(index, entry); entry = undefined }
      if (!entry) {
        if (entries.size >= 50) return undefined
        entry = { file, url: objectUrls.createObjectURL(file) }
        entries.set(index, entry)
      }
      const current = entry
      return { url: current.url, release: () => release(index, current) }
    },
    clear() {
      entries.forEach((entry, index) => release(index, entry))
    },
  }
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
