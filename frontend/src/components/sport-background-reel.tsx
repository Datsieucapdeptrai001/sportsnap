import { useEffect, useRef, useState } from 'react'

const scenes = [
  '/backgrounds/football.webp',
  '/backgrounds/basketball.webp',
  '/backgrounds/tennis.webp',
]

export function SportBackgroundReel() {
  const backgroundRef = useRef<HTMLDivElement>(null)
  const [activeScene, setActiveScene] = useState(0)

  useEffect(() => {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    let timer: number | undefined

    function syncPlayback() {
      window.clearInterval(timer)
      const paused = reducedMotion.matches || document.hidden
      backgroundRef.current?.style.setProperty('--reel-play-state', paused ? 'paused' : 'running')
      if (!paused) {
        timer = window.setInterval(() => {
          setActiveScene((current) => (current + 1) % scenes.length)
        }, 6000)
      }
    }

    syncPlayback()
    reducedMotion.addEventListener('change', syncPlayback)
    document.addEventListener('visibilitychange', syncPlayback)
    return () => {
      window.clearInterval(timer)
      reducedMotion.removeEventListener('change', syncPlayback)
      document.removeEventListener('visibilitychange', syncPlayback)
    }
  }, [])

  return (
    <div ref={backgroundRef} aria-hidden="true" className="sport-reel">
      {scenes.map((src, index) => (
        <div key={src} className="sport-reel-frame" data-active={activeScene === index}>
          <img src={src} alt="" draggable={false} decoding="async" fetchPriority={index === 0 ? 'high' : 'low'} />
        </div>
      ))}
      <div className="absolute inset-0 bg-black/55 backdrop-blur-[2px]" />
      <div className="sport-reel-vignette absolute inset-0" />
    </div>
  )
}
