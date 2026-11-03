import { cn } from '../../lib/utils'

export function Progress({ value, label, className }: { value: number; label: string; className?: string }) {
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value} className="h-2.5 overflow-hidden rounded-full bg-muted">
      <div className={cn('h-full rounded-full bg-primary transition-[width] duration-200', className)} style={{ width: `${value}%` }} />
    </div>
  )
}
