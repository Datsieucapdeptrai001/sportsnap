import type { ComponentProps } from 'react'
import { cn } from '../../lib/utils'

export function Card({ className, ...props }: ComponentProps<'section'>) {
  return (
    <section
      data-slot="card"
      className={cn('glass-surface rounded-xl border p-6 text-card-foreground transition-[border-color,box-shadow] duration-200 hover:border-primary/25', className)}
      {...props}
    />
  )
}
