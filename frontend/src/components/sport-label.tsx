import { splitSportLabel } from '../lib/sport-names'

export function SportLabel({ label }: { label: string }) {
  const { display, raw } = splitSportLabel(label)
  return (
    <>
      {display}
      {raw && <span className="ml-1.5 text-xs font-normal text-muted-foreground">({raw})</span>}
    </>
  )
}
