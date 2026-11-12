import type { ComponentProps } from 'react'
import { cn } from '../../lib/utils'

type ButtonVariant = 'default' | 'outline' | 'ink' | 'ghost'

const variants: Record<ButtonVariant, string> = {
  default: 'bg-primary text-primary-foreground enabled:hover:bg-primary/90',
  ink: 'bg-ink text-ink-foreground enabled:hover:bg-ink/85',
  outline: 'border border-border bg-card text-foreground enabled:hover:border-foreground/40 enabled:hover:bg-muted/60',
  ghost: 'text-foreground enabled:hover:bg-muted',
}

export function Button({ className, variant = 'default', ...props }: ComponentProps<'button'> & { variant?: ButtonVariant }) {
  return (
    <button
      type="button"
      data-slot="button"
      className={cn(
        'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50',
        variants[variant],
        className,
      )}
      {...props}
    />
  )
}
