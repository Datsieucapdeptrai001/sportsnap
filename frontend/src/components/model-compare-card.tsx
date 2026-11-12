import { useEffect, useRef, useState } from 'react'
import { GitCompare, LoaderCircle, TriangleAlert } from 'lucide-react'
import { compareModels, type ModelComparisonItem } from '../lib/api'
import { SportLabel } from './sport-label'
import { Button } from './ui/button'
import { Card } from './ui/card'
import { Progress } from './ui/progress'

const percentage = new Intl.NumberFormat('vi-VN', { style: 'percent', maximumFractionDigits: 1 })

type CompareState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; items: ModelComparisonItem[] }
  | { status: 'error'; message: string }

export function ModelCompareCard({
  image,
  activeModelId,
}: {
  image: Blob | null
  activeModelId?: string | null
}) {
  const [state, setState] = useState<CompareState>({ status: 'idle' })
  const controllerRef = useRef<AbortController | null>(null)

  useEffect(() => {
    controllerRef.current?.abort()
    setState({ status: 'idle' })
    return () => controllerRef.current?.abort()
  }, [image])

  async function runComparison() {
    if (!image) return
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    setState({ status: 'loading' })
    try {
      const response = await compareModels(image, controller.signal)
      if (!controller.signal.aborted) {
        setState({ status: 'success', items: response.results })
      }
    } catch (error) {
      if (controller.signal.aborted) return
      const message = error instanceof Error ? error.message : 'Chưa thể so sánh các mô hình.'
      setState({ status: 'error', message })
    }
  }

  if (!image) return null

  return (
    <Card aria-label="So sánh tất cả mô hình" className="surface-enter mt-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">So sánh tất cả mô hình trên ảnh này</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Chạy cùng một ảnh qua toàn bộ mô hình hiện có để đối chiếu kết quả
          </p>
        </div>
        <Button
          variant="outline"
          disabled={state.status === 'loading'}
          onClick={() => void runComparison()}
        >
          {state.status === 'loading' ? (
            <>
              <LoaderCircle size={16} className="motion-safe:animate-spin" aria-hidden="true" />
              Đang chạy tất cả…
            </>
          ) : (
            <>
              <GitCompare size={16} aria-hidden="true" />
              {state.status === 'success' ? 'Chạy lại tất cả' : 'Test tất cả mô hình'}
            </>
          )}
        </Button>
      </div>

      {state.status === 'error' && (
        <p role="alert" className="mt-4 flex items-center gap-2 text-sm text-destructive">
          <TriangleAlert size={16} className="shrink-0" aria-hidden="true" />
          {state.message}
        </p>
      )}

      {state.status === 'success' && (
        <ul className="mt-4 space-y-3 border-t border-border pt-4">
          {state.items.map((item) => {
            const uncertain = item.prediction.is_uncertain
            const isCurrent = item.id === activeModelId
            return (
              <li
                key={item.id}
                className="rounded-xl border border-border/70 bg-background/40 p-3 text-sm"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{item.name}</span>
                    {isCurrent && (
                      <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-medium text-primary">
                        Đang chọn
                      </span>
                    )}
                    {uncertain && (
                      <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-warning">
                        Không chắc chắn
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {item.prediction.latency_ms} ms
                  </span>
                </div>
                <div className="mt-2 flex items-center justify-between gap-3">
                  <SportLabel label={item.prediction.label} />
                  <span
                    className={
                      uncertain
                        ? 'font-semibold text-warning tabular-nums'
                        : 'font-semibold text-primary tabular-nums'
                    }
                  >
                    {percentage.format(item.prediction.confidence)}
                  </span>
                </div>
                <Progress
                  value={item.prediction.confidence * 100}
                  label={item.name}
                  className={uncertain ? 'mt-2 bg-warning' : 'mt-2'}
                />
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}
