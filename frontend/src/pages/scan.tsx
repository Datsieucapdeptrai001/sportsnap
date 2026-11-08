import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { Camera, ImagePlus, ImageUp, ScanLine, ShieldCheck, TriangleAlert, X } from 'lucide-react'
import { toast } from 'sonner'
import { PredictionCard } from '../components/prediction-card'
import { CameraScanner } from '../components/camera-scanner'
import { SportTags } from '../components/sport-tags'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { Skeleton } from '../components/ui/skeleton'
import { getClasses, predictImage, type Prediction, type ScanResult } from '../lib/api'
import { warnAboutUnmappedClasses } from '../lib/sports3d'
import { readAutoOpenArPreference, saveAutoOpenArPreference } from '../lib/ar'

type ScanState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; result: Prediction | ScanResult; image: Blob | null; source: 'camera' | 'image'; resultId: number }
  | { status: 'error'; message: string }

function ImagePreview({ file }: { file: File }) {
  const imageRef = useRef<HTMLImageElement>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const url = URL.createObjectURL(file)
    if (imageRef.current) imageRef.current.src = url
    return () => URL.revokeObjectURL(url)
  }, [file])

  return (
    <div className="surface-enter flex aspect-[16/10] items-center justify-center overflow-hidden rounded-xl bg-muted/40">
      <img
        ref={imageRef}
        alt="Ảnh đã chọn để nhận diện"
        onError={() => setFailed(true)}
        className={failed ? 'hidden' : 'size-full object-contain'}
      />
      {failed && <p className="px-6 text-center text-sm text-muted-foreground">Không thể xem trước ảnh này.</p>}
    </div>
  )
}

export function ScanPage({ active = true }: { active?: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const requestRef = useRef<AbortController | null>(null)
  const resultSequence = useRef(0)
  const [autoOpenAr, setAutoOpenAr] = useState(readAutoOpenArPreference)
  const [file, setFile] = useState<File | null>(null)
  const [mode, setMode] = useState<'camera' | 'gallery'>('camera')
  const [state, setState] = useState<ScanState>({ status: 'idle' })

  useEffect(() => () => requestRef.current?.abort(), [])

  useEffect(() => {
    if (!import.meta.env.DEV) return
    const controller = new AbortController()
    getClasses(controller.signal).then(warnAboutUnmappedClasses).catch(() => {
      if (!controller.signal.aborted) console.warn('Could not validate 3D mapping against /api/classes.')
    })
    return () => controller.abort()
  }, [])

  async function recognize(selected: File) {
    requestRef.current?.abort()
    const controller = new AbortController()
    requestRef.current = controller
    setState({ status: 'loading' })
    try {
      const result = await predictImage(selected, controller.signal)
      if (!controller.signal.aborted) setState({ status: 'success', result, image: selected, source: 'image', resultId: ++resultSequence.current })
    } catch (error) {
      if (controller.signal.aborted) return
      const message = error instanceof Error ? error.message : 'Chưa thể nhận diện ảnh. Vui lòng thử lại.'
      setState({ status: 'error', message })
      toast.error(message)
    }
  }

  function selectImage(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0]
    event.target.value = ''
    if (!selected) return
    setFile(selected)
    void recognize(selected)
  }

  function clearImage() {
    requestRef.current?.abort()
    setFile(null)
    setState({ status: 'idle' })
  }

  function changeMode(nextMode: 'camera' | 'gallery') {
    clearImage()
    setMode(nextMode)
  }

  return (
    <>
      <header className="text-white">
        <p className="mb-3 flex items-center gap-2 text-xs font-semibold tracking-widest text-emerald-300 uppercase">
          <ScanLine size={16} aria-hidden="true" />Nhận diện môn thể thao
        </p>
        <h1 className="text-3xl leading-tight font-semibold tracking-tight sm:text-4xl">
          Môn thể thao nào<br className="hidden sm:block" /> trong ảnh của bạn?
        </h1>
        <p className="mt-4 max-w-lg text-sm leading-relaxed text-slate-200 sm:text-base">
          Quét bằng camera hoặc chọn ảnh từ thư viện để khám phá môn thể thao và các dự đoán phù hợp nhất.
        </p>
      </header>
      <SportTags />
      <Card aria-label="Camera và thư viện ảnh" className="hud-panel p-4 sm:p-6">
        <div className="mb-4 flex gap-2" role="group" aria-label="Chế độ nhận diện">
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
          state.status === 'success' ? (
            <Button className="w-full" onClick={() => changeMode('camera')}><Camera size={18} aria-hidden="true" />Quay lại camera trực tiếp</Button>
          ) : (
            // Unmounting the scanner releases every camera track before the AR dialog opens.
            active && <CameraScanner onResult={(result, image) => setState({ status: 'success', result, image, source: 'camera', resultId: ++resultSequence.current })} />
          )
        ) : file ? (
          <>
            <ImagePreview key={`${file.name}-${file.lastModified}`} file={file} />
            <div className="mt-4 flex items-center gap-3">
              <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground" title={file.name}>{file.name}</span>
              <Button variant="outline" onClick={clearImage} aria-label="Xóa ảnh đã chọn" className="size-11 shrink-0 p-0">
                <X size={18} aria-hidden="true" />
              </Button>
            </div>
          </>
        ) : (
          <label htmlFor="scan-image" className="group flex min-h-56 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-primary/20 bg-primary/[0.03] px-5 py-8 text-center transition-all duration-200 hover:border-primary/40 hover:bg-primary/[0.06] hover:shadow-[inset_0_0_24px_var(--glass-glow)] motion-safe:hover:scale-[1.005] motion-safe:active:scale-[0.98] sm:min-h-64">
            <div className="mb-5 flex size-16 items-center justify-center rounded-2xl border border-primary/15 bg-card/65 text-primary shadow-sm transition-transform duration-200 motion-safe:group-hover:-translate-y-1">
              <ImagePlus size={30} strokeWidth={1.5} aria-hidden="true" />
            </div>
            <h2 className="text-lg font-semibold">Bắt đầu từ một bức ảnh</h2>
            <p className="mt-2 max-w-xs text-sm leading-relaxed text-muted-foreground">
              Chọn ảnh từ thư viện hoặc chụp ảnh bằng trình chọn ảnh trên điện thoại.
            </p>
          </label>
        )}
        {mode === 'gallery' && <Button className="mt-4 w-full" onClick={() => inputRef.current?.click()}>
          <ImageUp size={18} aria-hidden="true" />{file ? 'Chọn ảnh khác' : 'Chọn ảnh từ thư viện'}
        </Button>}
        {mode === 'camera' && <label className="mt-4 flex min-h-11 cursor-pointer items-center gap-3 text-sm">
          <input type="checkbox" role="switch" checked={autoOpenAr} onChange={(event) => {
            setAutoOpenAr(event.target.checked)
            saveAutoOpenArPreference(event.target.checked)
          }} className="size-5 shrink-0 accent-emerald-500" />
          Tự mở AR sau khi quét
        </label>}
        {mode === 'camera' && state.status === 'success' && <p className="mt-2 text-sm text-muted-foreground">Camera đã tạm dừng sau lượt quét để có thể dùng AR. Bấm Quay lại camera trực tiếp khi muốn quét tiếp.</p>}
        {mode === 'camera' && <Button variant="outline" className="mt-4 w-full" onClick={() => { changeMode('gallery'); inputRef.current?.click() }}>
          <ImageUp size={18} aria-hidden="true" />Chọn ảnh từ thư viện
        </Button>}
        {mode === 'gallery' && <p className="mt-3 text-center text-xs text-muted-foreground">Hỗ trợ JPG, JPEG, PNG và WebP · Mỗi lần một ảnh</p>}
      </Card>
      <p role="status" aria-live="polite" className="sr-only">
        {state.status === 'loading' ? 'Đang nhận diện ảnh. Vui lòng đợi.' : state.status === 'success' ? `Đã có kết quả: ${state.result.label}. ${state.result.is_uncertain ? 'Không chắc chắn.' : ''}` : ''}
      </p>
      <div className="mt-6" aria-busy={state.status === 'loading'}>
        {state.status === 'idle' && (
          <div className="glass-surface flex gap-3 rounded-xl border px-5 py-5 text-muted-foreground">
            <ScanLine size={21} className="mt-0.5 shrink-0" aria-hidden="true" />
            <div>
              <h2 className="text-sm font-medium text-foreground">Kết quả sẽ xuất hiện tại đây</h2>
              <p className="mt-1 text-sm leading-relaxed">Ảnh rõ, có người chơi hoặc dụng cụ giúp mô hình dễ nhận diện hơn.</p>
            </div>
          </div>
        )}
        {state.status === 'loading' && (
          <Card aria-label="Đang nhận diện ảnh">
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
        {state.status === 'success' && <PredictionCard key={state.resultId} result={state.result} image={state.image}
          autoOpenAr={{ resultId: state.resultId, source: state.source, enabled: autoOpenAr && active }} />}
      </div>
      <p className="mt-6 flex items-start justify-center gap-2 text-xs leading-relaxed text-slate-300">
        <ShieldCheck size={16} className="shrink-0" aria-hidden="true" />Ảnh chỉ được gửi đến hệ thống để nhận diện.
      </p>
    </>
  )
}
