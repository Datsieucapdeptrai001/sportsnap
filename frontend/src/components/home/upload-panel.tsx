import { useRef, useState, type DragEvent } from 'react'
import { ImagePlus, RefreshCw } from 'lucide-react'
import { SAMPLE_PHOTOS, type SamplePhoto } from '../../lib/samples'
import { cn } from '../../lib/utils'

export function UploadPanel({ previewUrl, previewName, busy, activeSampleId, onFile, onSample }: {
  previewUrl: string | null
  previewName: string | null
  busy: boolean
  activeSampleId: string | null
  onFile: (file: File) => void
  onSample: (sample: SamplePhoto) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  function pick() {
    if (!busy) inputRef.current?.click()
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setDragging(false)
    if (busy) return
    const file = event.dataTransfer.files?.[0]
    if (file) onFile(file)
  }

  return (
    <section aria-labelledby="upload-title">
      <h2 id="upload-title" className="sr-only">Chọn ảnh</h2>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file) onFile(file)
        }}
      />
      <div
        role="button"
        tabIndex={busy ? -1 : 0}
        aria-disabled={busy}
        aria-label={previewUrl ? 'Chọn ảnh khác' : 'Chọn hoặc kéo thả ảnh vào đây'}
        onClick={pick}
        onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); pick() } }}
        onDragOver={(event) => { event.preventDefault(); if (!busy) setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          'group relative flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded-3xl border-2 border-dashed transition-colors duration-200 outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-4 focus-visible:ring-offset-background',
          previewUrl ? 'border-transparent bg-card' : 'border-slate-700 bg-card/40',
          !busy && 'cursor-pointer hover:border-primary/60',
          dragging && 'border-primary bg-primary/10',
          busy && 'cursor-progress',
        )}
      >
        {previewUrl ? (
          <>
            <img src={previewUrl} alt={previewName ? `Ảnh đang nhận diện: ${previewName}` : 'Ảnh đang nhận diện'} className="size-full object-contain" />
            {busy && <div className="photo-finish" aria-hidden="true"><span className="photo-finish__line" /></div>}
            {!busy && (
              <span className="absolute right-3 bottom-3 inline-flex items-center gap-1.5 rounded-full bg-slate-950/80 px-3 py-1.5 text-xs font-medium text-slate-100 backdrop-blur group-hover:bg-slate-950">
                <RefreshCw size={13} aria-hidden="true" />Đổi ảnh
              </span>
            )}
          </>
        ) : (
          <div className="pointer-events-none flex max-w-xs flex-col items-center px-6 text-center">
            <span className={cn('mb-4 flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary transition-transform duration-200', dragging && 'scale-110')}>
              <ImagePlus size={28} strokeWidth={1.6} aria-hidden="true" />
            </span>
            <p className="text-base font-semibold text-foreground">{dragging ? 'Thả ảnh vào đây' : 'Kéo thả ảnh vào đây'}</p>
            <p className="mt-1.5 text-sm text-muted-foreground">hoặc bấm để chọn ảnh từ máy. Ảnh JPG, PNG hoặc WebP.</p>
          </div>
        )}
      </div>

      <div className="mt-4">
        <p id="samples-title" className="text-xs text-muted-foreground">Chưa có ảnh? Thử một ảnh mẫu:</p>
        <ul aria-labelledby="samples-title" className="mt-2 grid grid-cols-4 gap-2.5 sm:gap-3">
          {SAMPLE_PHOTOS.map((sample) => (
            <li key={sample.id}>
              <button
                type="button"
                disabled={busy}
                onClick={() => onSample(sample)}
                aria-pressed={activeSampleId === sample.id}
                title={sample.credit}
                className={cn(
                  'group block w-full overflow-hidden rounded-xl border-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                  activeSampleId === sample.id ? 'border-primary' : 'border-transparent enabled:hover:border-slate-600',
                )}
              >
                <img src={sample.src} alt="" loading="lazy" className="aspect-square w-full object-cover" />
                <span className="block truncate bg-card px-2 py-1.5 text-xs text-slate-300">{sample.caption}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
