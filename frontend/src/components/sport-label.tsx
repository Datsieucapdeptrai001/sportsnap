// Sport names are shown as the English model labels (capitalised for display only).
export function SportLabel({ label }: { label: string }) {
  return <span className="capitalize">{label}</span>
}
