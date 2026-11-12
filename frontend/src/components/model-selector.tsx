import { Cpu, LoaderCircle, RefreshCw } from 'lucide-react'
import type { ModelInfo } from '../lib/api'
import { Button } from './ui/button'
import { Card } from './ui/card'

export function ModelSelector({
  models,
  activeModelId,
  loading,
  switching,
  error,
  onSelect,
  onRetry,
}: {
  models: ModelInfo[]
  activeModelId: string | null
  loading: boolean
  switching: boolean
  error: string
  onSelect: (modelId: string) => void
  onRetry: () => void
}) {
  const active = models.find((model) => model.id === activeModelId) ?? null

  return (
    <Card aria-label="Chọn mô hình nhận diện" className="mb-6 p-4 sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2.5">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">
            <Cpu size={18} aria-hidden="true" />
          </span>
          <div>
            <label htmlFor="active-model-select" className="block text-sm font-semibold">
              Mô hình AI đang dùng
            </label>
            <p className="text-xs text-muted-foreground">
              Đổi mô hình để thử nhận diện và Grad-CAM
            </p>
          </div>
        </div>
        {switching && (
          <span role="status" className="inline-flex items-center gap-2 text-xs font-medium text-primary">
            <LoaderCircle size={15} className="motion-safe:animate-spin" aria-hidden="true" />
            Đang nạp mô hình…
          </span>
        )}
      </div>

      {loading && !models.length ? (
        <p className="mt-3 text-xs text-muted-foreground">Đang tải danh sách mô hình…</p>
      ) : error && !models.length ? (
        <div role="alert" className="mt-3 flex flex-wrap items-center gap-3 rounded-xl border border-destructive/50 bg-destructive-surface p-3 text-sm">
          <span>{error}</span>
          <Button variant="outline" onClick={onRetry}>
            <RefreshCw size={14} aria-hidden="true" />Thử lại
          </Button>
        </div>
      ) : (
        <div className="mt-3 space-y-2.5">
          <select
            id="active-model-select"
            value={activeModelId ?? ''}
            disabled={switching || models.length === 0}
            onChange={(event) => {
              const nextId = event.target.value
              if (nextId && nextId !== activeModelId) onSelect(nextId)
            }}
            className="min-h-11 w-full rounded-xl border border-border bg-card px-3 py-2 text-sm font-medium text-foreground disabled:opacity-60"
          >
            {models.map((model) => (
              <option key={model.id} value={model.id}>
                {model.name} ({model.size_mb} MB)
              </option>
            ))}
          </select>

          {active && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="rounded-full border border-border bg-lane px-2.5 py-0.5 tabular-nums">
                {active.num_classes} môn
              </span>
              <span className="rounded-full border border-border bg-lane px-2.5 py-0.5">
                Tiền xử lý: {active.preprocess}
              </span>
              <span className="rounded-full border border-border bg-lane px-2.5 py-0.5 tabular-nums">
                {active.size_mb} MB
              </span>
              <span className="min-w-0 flex-1 truncate sm:flex-none">{active.description}</span>
            </div>
          )}
        </div>
      )}
    </Card>
  )
}
