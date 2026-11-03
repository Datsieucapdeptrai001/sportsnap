import type { ComponentProps } from 'react'
import { cn } from '../../lib/utils'

export function Button({ className, variant = 'default', ...props }: ComponentProps<'button'> & { variant?: 'default' | 'outline' }) {
  return (
    <button
      type="button"
      data-slot="button"
      className={cn(
        'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        variant === 'default' ? 'bg-primary text-primary-foreground hover:bg-primary/90' : 'border border-border bg-card hover:bg-muted',
        className,
      )}
      {...props}
    />
  )
}
