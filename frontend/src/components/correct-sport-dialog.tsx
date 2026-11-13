import { useMemo, useState } from 'react'
import { Check, Search, X } from 'lucide-react'
import { sportNamesVi } from '../lib/sport-names'
import { cn } from '../lib/utils'

export function CorrectSportDialog({
  open,
  onOpenChange,
  currentLabel,
  onSelect,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  currentLabel: string
  onSelect: (newLabel: string) => void
}) {
  const [search, setSearch] = useState('')

  const sportsList = useMemo(() => {
    return Object.entries(sportNamesVi).map(([id, viName]) => ({
      id,
      viName,
    }))
  }, [])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return sportsList
    return sportsList.filter(
      (s) =>
        s.id.toLowerCase().includes(q) ||
        s.viName.toLowerCase().includes(q),
    )
  }, [search, sportsList])

  if (!open) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="correct-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm"
      onClick={() => onOpenChange(false)}
    >
      <div
        className="relative w-full max-w-lg rounded-2xl border border-border bg-card p-5 shadow-2xl transition-all"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border pb-3">
          <h2 id="correct-dialog-title" className="text-lg font-semibold tracking-tight">
            Chọn môn thể thao đúng
          </h2>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded-lg p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Đóng"
          >
            <X size={18} />
          </button>
        </div>

        <div className="relative mt-3">
          <Search
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Tìm kiếm môn thể thao (tiếng Việt hoặc tiếng Anh)..."
            className="w-full rounded-xl border border-border bg-muted/40 py-2 pl-9 pr-3 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            autoFocus
          />
        </div>

        <div className="mt-4 max-h-72 overflow-y-auto space-y-1 pr-1">
          {filtered.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Không tìm thấy môn phù hợp với từ khóa &ldquo;{search}&rdquo;.
            </p>
          ) : (
            filtered.map((item) => {
              const selected = item.id === currentLabel
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    onSelect(item.id)
                    onOpenChange(false)
                  }}
                  className={cn(
                    'flex w-full min-h-11 items-center justify-between rounded-xl px-3 py-2 text-left text-sm transition-colors',
                    selected
                      ? 'bg-primary/10 font-semibold text-primary'
                      : 'hover:bg-muted text-foreground',
                  )}
                >
                  <div>
                    <span>{item.viName}</span>
                    <span className="ml-2 text-xs text-muted-foreground">({item.id})</span>
                  </div>
                  {selected && <Check size={16} className="text-primary shrink-0" />}
                </button>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
