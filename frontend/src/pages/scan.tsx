import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { Camera, History, ImageUp, ScanLine, ShieldCheck, TriangleAlert, X } from 'lucide-react'
import { toast } from 'sonner'
import { PredictionCard } from '../components/prediction-card'
import { CameraScanner, type CameraScannerHandle } from '../components/camera-scanner'
import { ModelCompareCard } from '../components/model-compare-card'
import { SportTags } from '../components/sport-tags'
import { SportViewer } from '../components/home/sport-viewer'
import { UploadPanel } from '../components/home/upload-panel'
import { isAcceptedImage, type SamplePhoto } from '../lib/samples'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { Skeleton } from '../components/ui/skeleton'
import { getClasses, predictImage, type Prediction, type ScanResult } from '../lib/api'
import { warnAboutUnmappedClasses } from '../lib/sports3d'
import { sportNameVi } from '../lib/sport-names'
import { readAutoOpenArPreference, saveAutoOpenArPreference } from '../lib/ar'
import { cn } from '../lib/utils'

type ScanState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; result: Prediction | ScanResult; image: Blob | null; source: 'camera' | 'image'; resultId: number }
  | { status: 'error'; message: string }

interface SessionHistoryEntry {
  id: number
  result: Prediction | ScanResult
  image: Blob | null
  source: 'camera' | 'image'
  thumbUrl: string | null
  ownedThumb: boolean
  timeText: string
}

const pctFmt = new Intl.NumberFormat('vi-VN', { style: 'percent', maximumFractionDigits: 0 })

export function ScanPage({
  active = true,
  activeModelId = null,
  isDevMode = false,
}: {
  active?: boolean
  activeModelId?: string | null
  isDevMode?: boolean
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const cameraRef = useRef<CameraScannerHandle>(null)
  const requestRef = useRef<AbortController | null>(null)
  const resultSequence = useRef(0)
  const previousModelRef = useRef<string | null>(activeModelId)
  const [autoOpenAr, setAutoOpenAr] = useState(readAutoOpenArPreference)
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<{ url: string; owned: boolean; sampleId: string | null } | null>(null)
  const [mode, setMode] = useState<'camera' | 'gallery'>('camera')
  const [overrideLabel, setOverrideLabel] = useState<string | null>(null)
  const [previewSport, setPreviewSport] = useState<string | null>(null)
  const [history, setHistory] = useState<SessionHistoryEntry[]>([])
  const [state, setState] = useState<ScanState>({ status: 'idle' })

  const historyRef = useRef<SessionHistoryEntry[]>([])
  historyRef.current = history

  useEffect(() => () => {
    requestRef.current?.abort()
    for (const item of historyRef.current) {
      if (item.ownedThumb && item.thumbUrl) URL.revokeObjectURL(item.thumbUrl)
    }
  }, [])
  useEffect(() => () => { if (preview?.owned) URL.revokeObjectURL(preview.url) }, [preview])

  useEffect(() => {
    if (!import.meta.env.DEV) return
    const controller = new AbortController()
    getClasses(controller.signal).then(warnAboutUnmappedClasses).catch(() => {
      if (!controller.signal.aborted) console.warn('Could not validate 3D mapping against /api/classes.')
    })
    return () => controller.abort()
  }, [activeModelId])

  useEffect(() => {
    const previous = previousModelRef.current
    previousModelRef.current = activeModelId
    if (previous !== null && activeModelId && previous !== activeModelId && mode === 'gallery' && file) {
      void recognize(file)
    }
  }, [activeModelId, file, mode])

  function pushSessionHistory(
    id: number,
    result: Prediction | ScanResult,
    image: Blob | null,
    source: 'camera' | 'image',
    sampleUrl?: string | null,
  ) {
    const thumbUrl = sampleUrl ?? (image ? URL.createObjectURL(image) : null)
    const ownedThumb = !sampleUrl && Boolean(thumbUrl)
    const timeText = new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    setHistory((prev) => {
      const next: SessionHistoryEntry[] = [{ id, result, image, source, thumbUrl, ownedThumb, timeText }, ...prev]
      const dropped = next.slice(6)
      for (const item of dropped) {
        if (item.ownedThumb && item.thumbUrl) URL.revokeObjectURL(item.thumbUrl)
      }
      return next.slice(0, 6)
    })
  }

  // Allow pasting an image directly from clipboard (Ctrl+V) on the Scan page.
  useEffect(() => {
    if (!active) return
    const onPaste = (event: ClipboardEvent) => {
      const items = event.clipboardData?.items
      if (!items) return
      for (let i = 0; i < items.length; i += 1) {
        const item = items[i]
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          const pasted = item.getAsFile()
          if (!pasted) continue
          event.preventDefault()
          setMode('gallery')
          takeImage(pasted)
          return
        }
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  })

  async function recognize(selected: File, sampleUrl?: string | null) {
    requestRef.current?.abort()
    const controller = new AbortController()
    requestRef.current = controller
    setPreviewSport(null)
    setOverrideLabel(null)
    setState({ status: 'loading' })
    try {
      const result = await predictImage(selected, controller.signal, activeModelId)
      if (!controller.signal.aborted) {
        const resultId = ++resultSequence.current
        setState({ status: 'success', result, image: selected, source: 'image', resultId })
        pushSessionHistory(resultId, result, selected, 'image', sampleUrl)
      }
    } catch (error) {
      if (controller.signal.aborted) return
      const message = error instanceof Error ? error.message : 'Chưa thể nhận diện ảnh. Vui lòng thử lại.'
      setState({ status: 'error', message })
      toast.error(message)
    }
  }

  function takeImage(selected: File, sample: SamplePhoto | null = null) {
    if (state.status === 'loading') return
    if (!isAcceptedImage(selected)) {
      setState({ status: 'error', message: 'Tệp này không phải ảnh JPG, PNG hoặc WebP. Vui lòng chọn ảnh khác.' })
      return
    }
    setFile(selected)
    setPreview(sample ? { url: sample.src, owned: false, sampleId: sample.id } : { url: URL.createObjectURL(selected), owned: true, sampleId: null })
    void recognize(selected, sample?.src ?? null)
  }

  function selectImage(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0]
    event.target.value = ''
    if (selected) takeImage(selected)
  }

  async function selectSample(sample: SamplePhoto) {
    if (state.status === 'loading') return
    try {
      const response = await fetch(sample.src)
      if (!response.ok) throw new Error('sample missing')
      const blob = await response.blob()
      takeImage(new File([blob], sample.src.split('/').pop() ?? 'sample.jpg', { type: blob.type || 'image/jpeg' }), sample)
    } catch {
      setState({ status: 'error', message: 'Không mở được ảnh mẫu. Kiểm tra kết nối mạng hoặc chọn ảnh từ máy của bạn.' })
    }
  }

  function clearImage() {
    requestRef.current?.abort()
    setFile(null)
    setPreview(null)
    setOverrideLabel(null)
    setState({ status: 'idle' })
  }

  function changeMode(nextMode: 'camera' | 'gallery') {
    clearImage()
    setMode(nextMode)
  }

  function handleSelectSportTag(label: string) {
    setPreviewSport((prev) => (prev === label ? null : label))
  }

  function restoreHistoryEntry(entry: SessionHistoryEntry) {
    setPreviewSport(null)
    setOverrideLabel(null)
    if (entry.thumbUrl && entry.source === 'image') {
      setMode('gallery')
      setPreview({ url: entry.thumbUrl, owned: false, sampleId: null })
    }
    setState({ status: 'success', result: entry.result, image: entry.image, source: entry.source, resultId: entry.id })
  }

  const activeResultId = state.status === 'success' ? state.resultId : null

  return (
    <>
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="font-display text-2xl leading-tight font-bold tracking-tight sm:text-3xl">Môn thể thao nào trong ảnh?</h1>
        <p className="text-sm text-muted-foreground">Quét hoặc chọn ảnh, kết quả và mô hình 3D hiện ngay.</p>
      </header>
      <SportTags
        key={activeModelId ?? 'default'}
        selectedLabel={previewSport}
        onSelect={handleSelectSportTag}
      />

      {history.length > 0 && (
        <section aria-label="Lịch sử quét trong phiên" className="mb-5">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <History size={13} aria-hidden="true" />Quét gần đây trong phiên ({history.length})
            </h2>
            <button
              type="button"
              onClick={() => {
                for (const item of history) {
                  if (item.ownedThumb && item.thumbUrl) URL.revokeObjectURL(item.thumbUrl)
                }
                setHistory([])
              }}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Xóa lịch sử
            </button>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {history.map((item) => {
              const selected = activeResultId === item.id && !previewSport
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => restoreHistoryEntry(item)}
                  className={cn(
                    'flex shrink-0 items-center gap-2 rounded-2xl border px-2.5 py-1.5 text-left transition-colors',
                    selected ? 'border-primary bg-primary/10' : 'border-border bg-card/80 hover:border-primary/50',
                  )}
                >
                  {item.thumbUrl && (
                    <img src={item.thumbUrl} alt="" className="size-9 rounded-lg object-cover" />
                  )}
                  <div className="min-w-0">
                    <p className="max-w-28 truncate text-xs font-semibold">{sportNameVi(item.result.label)}</p>
                    <p className="text-[11px] text-muted-foreground tabular-nums">
                      {pctFmt.format(item.result.confidence)} · {item.timeText}
                    </p>
                  </div>
                </button>
              )
            })}
          </div>
        </section>
      )}

      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:gap-6">
        <Card aria-label="Camera và thư viện ảnh" className="hud-panel min-w-0 rounded-3xl p-3 sm:p-5 lg:sticky lg:top-6">
          <div className="mb-3 flex gap-2" role="group" aria-label="Chế độ nhận diện">
            <Button className="flex-1" variant={mode === 'camera' ? 'default' : 'outline'} aria-pressed={mode === 'camera'} onClick={() => changeMode('camera')}>
              <Camera size={18} aria-hidden="true" />Camera
            </Button>
            <Button className="flex-1" variant={mode === 'gallery' ? 'default' : 'outline'} aria-pressed={mode === 'gallery'} onClick={() => changeMode('gallery')}>
              <ImageUp size={18} aria-hidden="true" />Thư viện
            </Button>
          </div>
          <input
            ref={inputRef}
            id="scan-image"
            type="file"
            accept="image/*"
            aria-label="Chọn ảnh từ thư viện"
            onChange={selectImage}
            className="sr-only"
            tabIndex={-1}
          />
          {mode === 'camera' ? (
            active && <CameraScanner ref={cameraRef} autoOverlay={autoOpenAr}
              result={state.status === 'success' && state.source === 'camera' && 'agreement' in state.result ? state.result : null}
              onReset={() => setState({ status: 'idle' })}
              onResult={(result, image) => {
                setPreviewSport(null)
                setOverrideLabel(null)
                const resultId = ++resultSequence.current
                setState({ status: 'success', result, image, source: 'camera', resultId })
                pushSessionHistory(resultId, result, image, 'camera', null)
              }} />
          ) : (
            <UploadPanel
              previewUrl={preview?.url ?? null}
              previewName={null}
              busy={state.status === 'loading'}
              activeSampleId={preview?.sampleId ?? null}
              onFile={(selected) => takeImage(selected)}
              onSample={(sample) => void selectSample(sample)}
            />
          )}
          {mode === 'gallery' && <div className="mt-4 flex gap-2">
            <Button className="flex-1" disabled={state.status === 'loading'} onClick={() => inputRef.current?.click()}>
              <ImageUp size={18} aria-hidden="true" />{file ? 'Chọn ảnh khác' : 'Chọn ảnh từ thư viện'}
            </Button>
            {file && <Button variant="outline" onClick={clearImage} disabled={state.status === 'loading'} aria-label="Xóa ảnh đã chọn" className="size-11 shrink-0 p-0">
              <X size={18} aria-hidden="true" />
            </Button>}
          </div>}
          {mode === 'camera' && <label className="mt-4 flex min-h-11 cursor-pointer items-center gap-3 text-sm">
            <input type="checkbox" role="switch" checked={autoOpenAr} onChange={(event) => {
              setAutoOpenAr(event.target.checked)
              saveAutoOpenArPreference(event.target.checked)
            }} className="size-5 shrink-0 accent-emerald-500" />
            Tự hiện AR sau khi quét
          </label>}
          {mode === 'camera' && <Button variant="outline" className="mt-4 w-full" onClick={() => { changeMode('gallery'); inputRef.current?.click() }}>
            <ImageUp size={18} aria-hidden="true" />Chọn ảnh từ thư viện
          </Button>}
          {mode === 'gallery' && <p className="mt-3 text-center text-xs text-muted-foreground">Hỗ trợ JPG, JPEG, PNG, WebP · Kéo thả hoặc dán ảnh (Ctrl+V)</p>}
        </Card>
        <div className="min-w-0">
          <p role="status" aria-live="polite" className="sr-only">
            {state.status === 'loading' ? 'Đang nhận diện ảnh. Vui lòng đợi.' : state.status === 'success' ? `Đã có kết quả: ${sportNameVi(state.result.label)}. ${state.result.is_uncertain ? 'Không chắc chắn.' : ''}` : ''}
          </p>
          <div className="space-y-5" aria-busy={state.status === 'loading'}>
            {previewSport && (
              <SportViewer
                key={`preview-${previewSport}`}
                result={{ label: previewSport, is_uncertain: false }}
                previewMode
                onClosePreview={() => setPreviewSport(null)}
              />
            )}
            {!previewSport && state.status === 'idle' && (
              <>
                <div className="glass-surface flex gap-3 rounded-3xl border px-5 py-5 text-muted-foreground">
                  <ScanLine size={21} className="mt-0.5 shrink-0" aria-hidden="true" />
                  <div>
                    <h2 className="text-sm font-medium text-foreground">Kết quả sẽ xuất hiện tại đây</h2>
                    <p className="mt-1 text-sm leading-relaxed">Ảnh rõ, có người chơi hoặc dụng cụ giúp mô hình dễ nhận diện hơn. Bạn cũng có thể bấm bất kỳ môn nào ở trên để xem 3D &amp; chơi thử AR.</p>
                  </div>
                </div>
                <SportViewer result={null} />
              </>
            )}
            {state.status === 'loading' && (
              <Card aria-label="Đang nhận diện ảnh" className="rounded-3xl">
                <p className="mb-5 flex items-center gap-2 text-sm font-medium text-primary">
                  <ScanLine size={18} aria-hidden="true" />Đang nhận diện ảnh…
                </p>
                <Skeleton className="h-8 w-1/2" />
                <Skeleton className="mt-6 h-3 w-full" />
                <div className="mt-6 space-y-3">
                  <Skeleton className="h-5 w-full" />
                  <Skeleton className="h-5 w-5/6" />
                  <Skeleton className="h-5 w-4/6" />
                </div>
              </Card>
            )}
            {state.status === 'error' && (
              <Card className="border-destructive/40 hover:border-destructive/50">
                <div role="alert" className="flex items-start gap-3">
                  <TriangleAlert size={21} className="mt-0.5 shrink-0 text-destructive" aria-hidden="true" />
                  <div>
                    <h2 className="font-semibold">Chưa thể nhận diện</h2>
                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{state.message}</p>
                  </div>
                </div>
                {file && <Button className="mt-5" variant="outline" onClick={() => void recognize(file)}>Thử lại</Button>}
              </Card>
            )}
            {state.status === 'success' && (
              <>
                {!previewSport && (
                  <SportViewer
                    key={`${state.resultId}-${overrideLabel || state.result.label}`}
                    result={overrideLabel ? { ...state.result, label: overrideLabel } : state.result}
                    onOpenAr={state.source === 'camera' ? () => cameraRef.current?.openAr() : undefined}
                  />
                )}
                <PredictionCard
                  key={`card-${state.resultId}`}
                  result={state.result}
                  image={state.image}
                  onOpenAr={state.source === 'camera' ? () => cameraRef.current?.openAr() : undefined}
                  onLabelChange={(newLabel) => setOverrideLabel(newLabel)}
                />
              </>
            )}
          </div>
        </div>
      </div>
      {isDevMode && state.status === 'success' && <ModelCompareCard image={state.image} activeModelId={activeModelId} />}
      <p className="mt-6 flex items-start justify-center gap-2 text-xs leading-relaxed text-muted-foreground">
        <ShieldCheck size={16} className="shrink-0" aria-hidden="true" />Ảnh chỉ được gửi đến hệ thống để nhận diện; lịch sử phiên tự xóa khi tải lại trang.
      </p>
    </>
  )
}
