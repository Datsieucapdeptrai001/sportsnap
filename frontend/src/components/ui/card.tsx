import type { ComponentProps } from 'react'
import { cn } from '../../lib/utils'

export function Card({ className, ...props }: ComponentProps<'section'>) {
  return (
    <section
      data-slot="card"
      className={cn('rounded-xl border border-border bg-card p-5 text-card-foreground sm:p-6', className)}
      {...props}
    />
  )
}
