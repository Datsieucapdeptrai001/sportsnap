import type { SplitExperiment } from './api'

export function metric(value: number | null, percent = false): string {
  if (value === null) return '—'
  return percent
    ? new Intl.NumberFormat('vi-VN', { style: 'percent', maximumFractionDigits: 2 }).format(value)
    : value.toLocaleString('vi-VN', { maximumFractionDigits: 4 })
}

export function confusionStrength(split: SplitExperiment, count: number): number {
  const maximum = Math.max(1, ...split.confusion_matrix.flat())
  return count / maximum
}
