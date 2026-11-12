// A miniature court: outline, half-way line and centre circle.
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" aria-hidden="true" className={className}>
      <rect width="40" height="40" rx="10" fill="var(--primary)" />
      <g fill="none" stroke="var(--primary-foreground)" strokeWidth="2">
        <rect x="8" y="11" width="24" height="18" rx="1.5" />
        <line x1="20" y1="11" x2="20" y2="29" />
        <circle cx="20" cy="20" r="4" />
      </g>
    </svg>
  )
}
