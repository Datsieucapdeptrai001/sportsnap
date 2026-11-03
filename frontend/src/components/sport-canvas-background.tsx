import { useEffect, useRef } from 'react'
import { startSportCanvas } from '../lib/sport-canvas'

export function SportCanvasBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (canvasRef.current) return startSportCanvas(canvasRef.current)
  }, [])

  return (
    <div aria-hidden="true" className="sport-canvas-background">
      <canvas ref={canvasRef} className="size-full opacity-20" />
    </div>
  )
}
