import { useEffect, useState } from 'react'
import { Box } from 'lucide-react'
import { getClasses } from '../lib/api'
import { sportNameVi } from '../lib/sport-names'
import { cn } from '../lib/utils'
import { Skeleton } from './ui/skeleton'

type TagsState =
  | { status: 'loading' }
  | { status: 'ready'; classes: string[] }
  | { status: 'error' }

export function SportTags({
  selectedLabel = null,
  onSelect,
}: {
  selectedLabel?: string | null
  onSelect?: (label: string) => void
}) {
  const [state, setState] = useState<TagsState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    getClasses(controller.signal).then((classes) => {
      if (!controller.signal.aborted) setState({ status: 'ready', classes })
    }).catch(() => {
      if (!controller.signal.aborted) setState({ status: 'error' })
    })
    return () => controller.abort()
  }, [attempt])

  function retry() {
    setState({ status: 'loading' })
    setAttempt((value) => value + 1)
  }

  return (
    <section aria-label="Các môn thể thao có thể nhận diện" className="mt-6 mb-5 min-w-0 border-t border-border/70 pt-4">
      <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">
          Các môn mô hình nhận diện được
          {state.status === 'ready' && state.classes.length > 0 && (
            <span className="ml-2 font-normal text-muted-foreground tabular-nums">{state.classes.length}</span>
          )}
        </h2>
        {onSelect && state.status === 'ready' && state.classes.length > 0 && (
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            <Box size={12} className="text-primary" aria-hidden="true" />
            Bấm vào môn bất kỳ để xem thử 3D &amp; chơi AR
          </p>
        )}
      </div>
      {state.status === 'loading' && (
        <div role="status" className="flex gap-2">
          <span className="sr-only">Đang tải danh sách môn thể thao…</span>
          <Skeleton className="h-8 w-20 rounded-full" />
          <Skeleton className="h-8 w-28 rounded-full" />
          <Skeleton className="h-8 w-20 rounded-full" />
        </div>
      )}
      {state.status === 'error' && (
        <div className="flex flex-wrap items-center gap-x-3 text-sm text-muted-foreground">
          <p role="status">Chưa tải được danh sách môn thể thao.</p>
          <button type="button" onClick={retry} className="min-h-11 rounded-lg px-2 font-medium text-primary hover:bg-muted">Thử lại</button>
        </div>
      )}
      {state.status === 'ready' && (state.classes.length ? (
        <div role="region" aria-label="Danh sách môn thể thao, cuộn ngang để xem thêm" tabIndex={0} className="sport-tags overflow-x-auto rounded-xl pb-2">
          <ul className="flex w-max gap-2 md:w-auto md:flex-wrap">
            {state.classes.map((label) => {
              const active = selectedLabel === label
              return (
                <li key={label}>
                  {onSelect ? (
                    <button
                      type="button"
                      title={`Xem 3D & AR môn ${sportNameVi(label)} (${label})`}
                      aria-pressed={active}
                      onClick={() => onSelect(label)}
                      className={cn(
                        'rounded-full border px-3 py-1.5 text-xs whitespace-nowrap transition-colors',
                        active
                          ? 'border-primary bg-primary/15 font-semibold text-primary'
                          : 'border-border bg-card text-foreground hover:border-primary/60 hover:bg-primary/5',
                      )}
                    >
                      {sportNameVi(label)}
                    </button>
                  ) : (
                    <span title={label} className="inline-block rounded-full border border-border bg-card px-3 py-1.5 text-xs whitespace-nowrap">
                      {sportNameVi(label)}
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      ) : <p className="text-sm text-muted-foreground">Danh sách môn thể thao sẽ hiển thị khi mô hình sẵn sàng.</p>)}
    </section>
  )
}
