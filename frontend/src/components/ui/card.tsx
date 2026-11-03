import type { ComponentProps } from 'react'
import { cn } from '../../lib/utils'

export function Card({ className, ...props }: ComponentProps<'section'>) {
  return (
    <section
      data-slot="card"
      className={cn('rounded-xl border border-border bg-card p-6 text-card-foreground shadow-sm', className)}
      {...props}
    />
  )
}
