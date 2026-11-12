import type { ClassConfidence } from '../lib/api'
import { sportNameVi } from '../lib/sport-names'
import { cn } from '../lib/utils'

const percentage = new Intl.NumberFormat('vi-VN', { style: 'percent', maximumFractionDigits: 1 })

/**
 * Top predictions drawn as running-track lanes: the lane number is the rank,
 * the painted trail runs from the start line toward the finish by probability.
 * Display only; labels and values come straight from the API.
 */
export function ConfidenceLanes({ predictions, uncertain, label = 'Ba dự đoán hàng đầu' }: {
  predictions: ClassConfidence[]; uncertain: boolean; label?: string
}) {
  return (
    <ol aria-label={label} className="overflow-hidden rounded-xl border border-border bg-lane">
      {predictions.map((prediction, index) => {
        const name = sportNameVi(prediction.label)
        const leader = index === 0
        return (
          <li key={prediction.label} className={cn('relative grid min-h-15 grid-cols-[auto_1fr_auto] items-center gap-3 py-2.5 pr-5 pl-3', index > 0 && 'border-t-2 border-lane-line')}>
            <span aria-hidden="true" className={cn('flex size-7 items-center justify-center rounded-md border text-xs font-semibold tabular-nums',
              leader ? (uncertain ? 'border-warning-line bg-warning-surface text-warning' : 'border-primary bg-primary text-primary-foreground') : 'border-border bg-card text-muted-foreground')}>
              {index + 1}
            </span>
            <span className="min-w-0">
              <span className={cn('block text-sm leading-snug break-words', leader ? 'font-semibold' : 'font-medium')}>{name}</span>
              {name !== prediction.label && <span className="block text-xs leading-snug text-muted-foreground">{prediction.label}</span>}
            </span>
            <span className={cn('text-sm tabular-nums', leader ? 'font-semibold' : 'text-muted-foreground')}>{percentage.format(prediction.confidence)}</span>
            <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-1.5">
              <span className={cn('lane-trail block h-full rounded-r-full', leader ? (uncertain ? 'bg-warning-bar' : 'bg-primary') : 'bg-rank')}
                style={{ width: `${Math.max(0, Math.min(1, prediction.confidence)) * 100}%`, animationDelay: `${index * 90}ms` }} />
            </span>
            <span aria-hidden="true" className="lane-finish absolute inset-y-0 right-0 w-1" />
          </li>
        )
      })}
    </ol>
  )
}

export function EmptyLanes({ pulse = false }: { pulse?: boolean }) {
  return (
    <div aria-hidden="true" className={cn('overflow-hidden rounded-xl border border-border bg-lane', pulse && 'motion-safe:animate-pulse')}>
      {[1, 2, 3].map((lane) => (
        <div key={lane} className={cn('relative flex min-h-15 items-center gap-3 px-3', lane > 1 && 'border-t-2 border-lane-line')}>
          <span className="flex size-7 items-center justify-center rounded-md border border-border bg-card text-xs font-semibold text-muted-foreground">{lane}</span>
          {pulse && <span className="h-3 w-2/5 rounded bg-muted" />}
          <span className="lane-finish absolute inset-y-0 right-0 w-1" />
        </div>
      ))}
    </div>
  )
}
