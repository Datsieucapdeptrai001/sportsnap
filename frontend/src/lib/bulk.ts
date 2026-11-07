import { getBulkJob, type BulkItem, type BulkState, type BulkStatus } from './api.ts'

export function isBulkTerminal(status: BulkState): boolean {
  return status === 'done' || status === 'error' || status === 'cancelled'
}

export function filterBulkItems(items: BulkItem[], label: string, uncertainOnly: boolean): BulkItem[] {
  return items.filter((item) => (!label || item.label === label) && (!uncertainOnly || item.is_uncertain))
}

interface PollDependencies {
  get: typeof getBulkJob
  schedule: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>
  clear: (timer: ReturnType<typeof setTimeout>) => void
}

export function pollBulkJob(
  jobId: string, onUpdate: (status: BulkStatus) => void, onError: (error: unknown) => void,
  dependencies: PollDependencies = { get: getBulkJob, schedule: setTimeout, clear: clearTimeout },
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
