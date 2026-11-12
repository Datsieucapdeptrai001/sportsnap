import { cn } from '../../lib/utils'

export function Progress({ value, label, className, marker }: {
  value: number; label: string; className?: string
  /** Optional tick (0–100) drawn on the track, e.g. the uncertainty threshold returned by the API. */
  marker?: number
}) {
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value} className="relative h-2.5 rounded-full bg-muted">
      <div className="h-full overflow-hidden rounded-full">
        <div className={cn('h-full rounded-full bg-primary transition-[width] duration-200', className)} style={{ width: `${value}%` }} />
      </div>
      {marker !== undefined && <span aria-hidden="true" className="absolute -top-1 -bottom-1 w-0.5 rounded-full bg-foreground/70" style={{ left: `${marker}%` }} />}
    </div>
  )
}
