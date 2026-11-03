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
    <section aria-label="Các môn thể thao có thể nhận diện" className="mt-6 mb-8 min-w-0">
      <p className="mb-3 text-xs font-medium tracking-wide text-slate-200">Các môn thể thao có thể nhận diện</p>
      {state.status === 'loading' && (
        <div role="status" className="flex gap-2">
          <span className="sr-only">Đang tải danh sách môn thể thao…</span>
          <Skeleton className="h-8 w-20 rounded-full bg-white/10" />
          <Skeleton className="h-8 w-28 rounded-full bg-white/10" />
          <Skeleton className="h-8 w-20 rounded-full bg-white/10" />
        </div>
      )}
      {state.status === 'error' && (
        <div className="flex flex-wrap items-center gap-x-3 text-xs text-slate-300">
          <p role="status">Chưa tải được danh sách môn thể thao.</p>
          <button type="button" onClick={retry} className="min-h-11 rounded-lg px-2 font-medium text-emerald-300 hover:bg-white/5">Thử lại</button>
        </div>
      )}
      {state.status === 'ready' && (state.classes.length ? (
        <div role="region" aria-label="Danh sách môn thể thao, cuộn ngang để xem thêm" tabIndex={0} className="sport-tags overflow-x-auto rounded-xl pb-2 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-300">
          <ul className="flex w-max gap-2">
            {state.classes.map((label) => (
              <li key={label} className="rounded-full border border-emerald-300/20 bg-slate-950/30 px-3 py-1.5 text-xs whitespace-nowrap text-slate-100 backdrop-blur-md">{label}</li>
            ))}
          </ul>
        </div>
      ) : <p className="text-xs text-slate-300">Danh sách môn thể thao sẽ hiển thị khi mô hình sẵn sàng.</p>)}
    </section>
  )
}
