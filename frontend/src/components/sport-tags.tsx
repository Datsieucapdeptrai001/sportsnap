import { useEffect, useState } from 'react'
import { getClasses } from '../lib/api'
import { Skeleton } from './ui/skeleton'

type TagsState =
  | { status: 'loading' }
  | { status: 'ready'; classes: string[] }
  | { status: 'error' }

export function SportTags() {
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
    <section aria-label="Các môn thể thao có thể nhận diện" className="mt-10 min-w-0 border-t border-border pt-6">
      <h2 className="mb-3 text-sm font-semibold">Các môn mô hình nhận diện được{state.status === 'ready' && state.classes.length > 0 && <span className="ml-2 font-normal text-muted-foreground tabular-nums">{state.classes.length}</span>}</h2>
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
            {state.classes.map((label) => (
              <li key={label} className="rounded-full border border-border bg-card px-3 py-1.5 text-xs whitespace-nowrap">{label}</li>
            ))}
          </ul>
        </div>
      ) : <p className="text-sm text-muted-foreground">Danh sách môn thể thao sẽ hiển thị khi mô hình sẵn sàng.</p>)}
    </section>
  )
}
