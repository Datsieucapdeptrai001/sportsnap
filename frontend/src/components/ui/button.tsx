import type { ComponentProps } from 'react'
import { cn } from '../../lib/utils'

export function Button({ className, variant = 'default', ...props }: ComponentProps<'button'> & { variant?: 'default' | 'outline' }) {
  return (
    <button
      type="button"
      data-slot="button"
      className={cn(
        'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-all duration-200 motion-safe:enabled:hover:scale-[1.01] motion-safe:enabled:active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50',
        variant === 'default'
          ? 'bg-primary text-primary-foreground shadow-sm enabled:hover:bg-primary/90 enabled:hover:shadow-md'
          : 'border border-border/60 bg-card/55 backdrop-blur-md enabled:hover:border-primary/30 enabled:hover:bg-primary/5',
        className,
      )}
      {...props}
    />
  )
}
