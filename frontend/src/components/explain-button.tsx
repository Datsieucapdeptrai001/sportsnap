import { useEffect, useId, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { Focus, LoaderCircle, X } from 'lucide-react'
import { explainImage } from '../lib/api'
import { loadExplanation, type ExplanationState } from '../lib/explain'
import { Button } from './ui/button'

function ExplainDialog({ image, onClose, returnFocusRef, camera }: {
  image: Blob; onClose: () => void; returnFocusRef: RefObject<HTMLButtonElement | null>; camera: boolean
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const originalRef = useRef<HTMLImageElement>(null)
  const overlayBackgroundRef = useRef<HTMLImageElement>(null)
  const [state, setState] = useState<ExplanationState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [opacity, setOpacity] = useState(100)
  const [imageFailed, setImageFailed] = useState(false)
  const titleId = useId()
  const sliderId = useId()

  useEffect(() => {
    const dialog = dialogRef.current
    const previousFocus = returnFocusRef.current ?? document.activeElement
    const previousOverflow = document.body.style.overflow
    dialog?.showModal()
    document.body.style.overflow = 'hidden'
    const url = URL.createObjectURL(image)
    if (originalRef.current) originalRef.current.src = url
    if (overlayBackgroundRef.current) overlayBackgroundRef.current.src = url
    return () => {
      URL.revokeObjectURL(url)
      dialog?.close()
      document.body.style.overflow = previousOverflow
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus()
    }
  }, [image, returnFocusRef])

  useEffect(() => {
    const controller = new AbortController()
    void loadExplanation(image, controller.signal, setState, explainImage)
    return () => controller.abort()
  }, [image, attempt])

  return createPortal(<dialog ref={dialogRef} aria-labelledby={titleId}
    className="fixed inset-0 m-auto max-h-[95svh] w-[calc(100%_-_1rem)] max-w-3xl overflow-y-auto rounded-xl border border-border bg-card p-4 text-card-foreground shadow-2xl backdrop:bg-black/75 sm:p-6"
    onCancel={(event) => { event.preventDefault(); event.stopPropagation(); onClose() }}
    onKeyDown={(event) => event.stopPropagation()}
    onClick={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <div className="flex items-center justify-between gap-3">
      <h2 id={titleId} className="text-xl font-semibold tracking-tight">Vùng AI chú ý <span className="font-normal text-muted-foreground">(Grad-CAM)</span></h2>
      <Button autoFocus variant="outline" className="size-11 shrink-0 p-0" aria-label="Đóng bản đồ chú ý" onClick={onClose}><X size={20} aria-hidden="true" /></Button>
    </div>
    <p className="mt-3 max-w-prose text-sm leading-relaxed text-muted-foreground">Màu nóng biểu thị vùng góp phần vào dự đoán. Đây là gợi ý giải thích, không phải vị trí vật thể được xác nhận.</p>
    <div className="mt-3 flex max-w-xs items-center gap-2 text-xs text-muted-foreground" aria-hidden="true"><span>Ít</span><span className="h-2 flex-1 rounded-full" style={{ background: 'linear-gradient(90deg, #00007f, #0000ff, #00ffff, #ffff00, #ff0000, #7f0000)' }} /><span>Nhiều</span></div>
    {camera && <p className="mt-3 max-w-prose rounded-xl border border-border bg-muted/50 p-3 text-sm leading-relaxed text-muted-foreground">Phân tích khung hình tốt nhất trong lượt quét; nhãn và độ tin cậy riêng của ảnh có thể khác kết quả trung bình nhiều khung hình.</p>}
    <div className="mt-5 grid gap-4 sm:grid-cols-2">
      <figure><figcaption className="mb-2 text-sm font-medium">Ảnh gốc</figcaption><img ref={originalRef} alt="Ảnh gốc dùng để giải thích" className="aspect-square w-full rounded-xl bg-muted/40 object-contain" onError={() => setImageFailed(true)} /></figure>
      <figure><figcaption className="mb-2 text-sm font-medium">Bản đồ chú ý</figcaption>
        <div className="relative flex aspect-square items-center justify-center overflow-hidden rounded-xl bg-muted/40" aria-busy={state.status === 'loading'}>
          <img ref={overlayBackgroundRef} alt="Ảnh nền" className={state.status === 'success' ? 'absolute size-full object-contain' : 'hidden'} />
          {state.status === 'loading' && <p role="status" className="flex items-center gap-2 p-4 text-sm"><LoaderCircle size={20} className="motion-safe:animate-spin" aria-hidden="true" />Đang tính vùng chú ý…</p>}
          {state.status === 'success' && <>
            <img alt={`Grad-CAM cho ${state.result.label}`} src={`data:image/png;base64,${state.result.overlay_png_base64}`} style={{ opacity: opacity / 100 }} className="absolute size-full object-contain" onError={() => setImageFailed(true)} />
          </>}
          {state.status === 'error' && <div role="alert" className="p-4 text-center text-sm"><p>{state.message}</p><Button className="mt-4" variant="outline" onClick={() => { setImageFailed(false); setAttempt((n) => n + 1) }}>Thử lại</Button></div>}
        </div>
      </figure>
    </div>
    {imageFailed && <p role="alert" className="mt-3 text-sm text-destructive">Không thể hiển thị ảnh. Hãy đóng rồi mở lại bản đồ chú ý.</p>}
    {state.status === 'success' && <div className="mt-5 space-y-4">
      <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1"><span className="text-lg font-semibold">{state.result.label}</span><span className="font-semibold tabular-nums">{(state.result.confidence * 100).toLocaleString('vi-VN', { maximumFractionDigits: 1 })}%</span>{state.result.is_uncertain && <span className="rounded-full border border-warning-line bg-warning-surface px-2 py-0.5 text-xs font-medium text-warning">Không chắc chắn</span>}</p>
      <div><label htmlFor={sliderId} className="flex justify-between text-sm"><span>Độ hiển thị lớp phủ</span><span className="tabular-nums">{opacity}%</span></label><input id={sliderId} type="range" min="0" max="100" value={opacity} onChange={(event) => setOpacity(Number(event.target.value))} className="min-h-11 w-full accent-[var(--primary)]" /></div>
    </div>}
  </dialog>, document.body)
}

export function ExplainButton({ image, camera = false, onOpenChange }: { image: Blob | null; camera?: boolean; onOpenChange?: (open: boolean) => void }) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  function changeOpen(next: boolean) {
    setOpen(next)
    onOpenChange?.(next)
  }
  return <>
    <Button ref={triggerRef} variant="ink" className="min-h-12 w-full" disabled={!image} aria-haspopup="dialog" aria-expanded={open} onClick={() => changeOpen(true)}><Focus size={18} aria-hidden="true" />Xem vùng AI chú ý</Button>
    {open && image && <ExplainDialog image={image} camera={camera} onClose={() => changeOpen(false)} returnFocusRef={triggerRef} />}
  </>
}
