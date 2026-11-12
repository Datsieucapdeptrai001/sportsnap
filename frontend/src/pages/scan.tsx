import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { Camera, ImagePlus, ImageUp, LoaderCircle, RotateCcw, ShieldCheck, TriangleAlert, X } from 'lucide-react'
import { toast } from 'sonner'
import { PredictionCard } from '../components/prediction-card'
import { EmptyLanes } from '../components/confidence-lanes'
import { CameraScanner, type CameraScannerHandle } from '../components/camera-scanner'
import { SportTags } from '../components/sport-tags'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { Skeleton } from '../components/ui/skeleton'
import { getClasses, predictImage, type Prediction, type ScanResult } from '../lib/api'
import { warnAboutUnmappedClasses } from '../lib/sports3d'
import { readAutoOpenArPreference, saveAutoOpenArPreference } from '../lib/ar'
import { cn } from '../lib/utils'

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
    <div className="surface-enter flex aspect-[4/3] items-center justify-center overflow-hidden rounded-xl border border-border bg-lane">
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
  const cameraRef = useRef<CameraScannerHandle>(null)
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
      <header>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Quét môn thể thao</h1>
        <p className="mt-2 max-w-prose text-sm leading-relaxed text-muted-foreground sm:text-base">
          Hướng camera vào trận đấu hoặc chọn một ảnh. Mô hình trả về môn phù hợp nhất và ba dự đoán hàng đầu.
        </p>
      </header>
      <section aria-label="Camera và thư viện ảnh" className="mt-5">
        <div className="mb-3 grid grid-cols-2 gap-1 rounded-xl bg-muted p-1" role="group" aria-label="Chế độ nhận diện">
          {([['camera', 'Camera', Camera], ['gallery', 'Thư viện', ImageUp]] as const).map(([value, text, Icon]) => (
            <button key={value} type="button" aria-pressed={mode === value} onClick={() => changeMode(value)}
              className={cn('inline-flex min-h-11 items-center justify-center gap-2 rounded-[10px] text-sm font-medium transition-colors duration-150',
                mode === value ? 'bg-card text-foreground shadow-[0_1px_0_var(--border)]' : 'text-muted-foreground hover:text-foreground')}>
              <Icon size={18} aria-hidden="true" />{text}
            </button>
          ))}
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
            onResult={(result, image) => setState({ status: 'success', result, image, source: 'camera', resultId: ++resultSequence.current })} />
        ) : file ? (
          <>
            <ImagePreview key={`${file.name}-${file.lastModified}`} file={file} />
            <div className="mt-3 flex items-center gap-3">
              <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground" title={file.name}>{file.name}</span>
              <Button variant="outline" onClick={clearImage} aria-label="Xóa ảnh đã chọn" className="size-11 shrink-0 p-0">
                <X size={18} aria-hidden="true" />
              </Button>
            </div>
          </>
        ) : (
          <label htmlFor="scan-image" className="court-box flex min-h-64 cursor-pointer flex-col items-center justify-center rounded-xl bg-lane px-6 py-10 text-center [--court-color:var(--primary)] hover:bg-primary-soft">
            <ImagePlus size={32} strokeWidth={1.5} className="mb-4 text-primary" aria-hidden="true" />
            <span className="text-lg font-semibold">Chọn một ảnh thể thao</span>
            <span className="mt-2 max-w-xs text-sm leading-relaxed text-muted-foreground">
              Trên điện thoại, bạn có thể chụp ảnh mới ngay từ trình chọn ảnh.
            </span>
          </label>
        )}
        {mode === 'gallery' && <>
          <Button className="mt-4 min-h-12 w-full" onClick={() => inputRef.current?.click()}>
            <ImageUp size={18} aria-hidden="true" />{file ? 'Chọn ảnh khác' : 'Chọn ảnh từ thư viện'}
          </Button>
          <p className="mt-3 text-center text-xs text-muted-foreground">Hỗ trợ JPG, JPEG, PNG và WebP, mỗi lần một ảnh.</p>
        </>}
        {mode === 'camera' && <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
            <input type="checkbox" role="switch" checked={autoOpenAr} onChange={(event) => {
              setAutoOpenAr(event.target.checked)
              saveAutoOpenArPreference(event.target.checked)
            }} className="size-5 shrink-0 accent-[var(--primary)]" />
            Tự hiện AR sau khi quét
          </label>
          <Button variant="ghost" className="-mr-2 text-primary" onClick={() => { changeMode('gallery'); inputRef.current?.click() }}>
            <ImageUp size={18} aria-hidden="true" />Chọn ảnh từ thư viện
          </Button>
        </div>}
      </section>
      <p role="status" aria-live="polite" className="sr-only">
        {state.status === 'loading' ? 'Đang nhận diện ảnh. Vui lòng đợi.' : state.status === 'success' ? `Đã có kết quả: ${state.result.label}. ${state.result.is_uncertain ? 'Không chắc chắn.' : ''}` : ''}
      </p>
      <div className="mt-8" aria-busy={state.status === 'loading'}>
        {state.status === 'idle' && (
          <section aria-label="Chưa có kết quả">
            <h2 className="text-sm font-semibold">Kết quả</h2>
            <p className="mt-1 mb-3 text-sm leading-relaxed text-muted-foreground">
              Quét hoặc chọn ảnh để điền ba làn dự đoán. Ảnh rõ, thấy người chơi hoặc dụng cụ giúp mô hình nhận diện tốt hơn.
            </p>
            <EmptyLanes />
          </section>
        )}
        {state.status === 'loading' && (
          <Card aria-label="Đang nhận diện ảnh">
            <p className="flex items-center gap-2 text-sm font-medium text-primary">
              <LoaderCircle size={18} className="motion-safe:animate-spin" aria-hidden="true" />Đang nhận diện ảnh…
            </p>
            <Skeleton className="mt-5 h-10 w-3/5" />
            <Skeleton className="mt-6 h-2.5 w-full" />
            <div className="mt-6"><EmptyLanes pulse /></div>
          </Card>
        )}
        {state.status === 'error' && (
          <Card className="border-destructive/50 bg-destructive-surface">
            <div role="alert" className="flex items-start gap-3">
              <TriangleAlert size={21} className="mt-0.5 shrink-0 text-destructive" aria-hidden="true" />
              <div>
                <h2 className="font-semibold">Chưa thể nhận diện</h2>
                <p className="mt-2 text-sm leading-relaxed">{state.message}</p>
              </div>
            </div>
            {file && <Button className="mt-5" variant="outline" onClick={() => void recognize(file)}><RotateCcw size={18} aria-hidden="true" />Thử lại</Button>}
          </Card>
        )}
        {state.status === 'success' && <PredictionCard key={state.resultId} result={state.result} image={state.image}
          onOpenAr={state.source === 'camera' ? () => cameraRef.current?.openAr() : undefined} />}
      </div>
      <SportTags />
      <p className="mt-6 flex items-start gap-2 text-xs leading-relaxed text-muted-foreground md:hidden">
        <ShieldCheck size={16} className="shrink-0" aria-hidden="true" />Ảnh chỉ được gửi đến hệ thống để nhận diện.
      </p>
    </>
  )
}
