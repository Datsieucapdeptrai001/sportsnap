import { useEffect, useMemo, useRef, useState } from 'react'
import { Download, Layers, LoaderCircle, Upload, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { Progress } from '../components/ui/progress'
import { Skeleton } from '../components/ui/skeleton'
import { cancelBulkJob, createBulkJob, downloadBulkJob, type BulkState, type BulkStatus } from '../lib/api'
import { bulkStatusAfterRemoval, createBulkPreviewUrls, filterBulkItems, isBulkTerminal, pairBulkPreviewItems, pollBulkJob } from '../lib/bulk'

const stateLabels: Record<BulkState, string> = {
  queued: 'Đang chờ', running: 'Đang phân loại', done: 'Đã hoàn tất', error: 'Phân loại thất bại', cancelled: 'Đã hủy',
}
const fileErrors: Record<string, string> = {
  unsupported_format: 'Định dạng không hỗ trợ', corrupt: 'Ảnh hỏng hoặc không đọc được', too_large: 'Vượt dung lượng cho phép',
}

function BulkThumbnail({ file, index, filename, previews, onOpen }: {
  file: File
  index: number
  filename: string
  previews: ReturnType<typeof createBulkPreviewUrls>
  onOpen: (url: string, filename: string) => void
}) {
  const imageRef = useRef<HTMLImageElement>(null)
  const leaseRef = useRef<ReturnType<typeof previews.acquire>>(undefined)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const lease = previews.acquire(index, file)
    leaseRef.current = lease
    if (lease && imageRef.current) imageRef.current.src = lease.url
    return () => { lease?.release(); leaseRef.current = undefined }
  }, [previews, index, file])

  if (failed) return <span className="flex size-[72px] items-center justify-center rounded-xl bg-muted p-1 text-center text-xs text-muted-foreground">Không xem được ảnh</span>
  return (
    <button type="button" className="block size-[72px] overflow-hidden rounded-xl bg-muted" aria-label={`Xem ảnh ${filename}`}
      onClick={() => { if (leaseRef.current) onOpen(leaseRef.current.url, filename) }}>
      <img ref={imageRef} width={72} height={72} alt={`Ảnh ${filename}`} loading="lazy" decoding="async" className="size-full object-cover" onError={() => setFailed(true)} />
    </button>
  )
}

function BulkLightbox({ url, filename, onClose }: { url: string; filename: string; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = dialogRef.current
    dialog?.showModal()
    return () => dialog?.close()
  }, [])
  return (
    <dialog ref={dialogRef} aria-label={`Xem ảnh ${filename}`} className="fixed inset-0 m-auto w-[calc(100%_-_2rem)] max-w-3xl overflow-visible rounded-xl bg-transparent p-0 text-card-foreground backdrop:bg-black/80"
      onCancel={onClose} onClick={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div className="rounded-xl bg-card p-3 shadow-xl sm:p-5">
        <div className="mb-3 flex items-center justify-between gap-3"><p className="min-w-0 break-all text-sm">{filename}</p><Button autoFocus variant="outline" className="shrink-0 px-3" aria-label="Đóng ảnh" onClick={onClose}><X size={20} aria-hidden="true" /></Button></div>
        <img src={url} alt={filename} decoding="async" className="mx-auto max-h-[70svh] max-w-full rounded-xl object-contain" />
      </div>
    </dialog>
  )
}

export function BulkPage({ active }: { active: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const requestRef = useRef<AbortController | null>(null)
  const stopPolling = useRef<(() => void) | null>(null)
  const urls = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const [files, setFiles] = useState<File[]>([])
  const [submittedFiles, setSubmittedFiles] = useState<File[]>([])
  const [previews] = useState(() => createBulkPreviewUrls())
  const [lightbox, setLightbox] = useState<{ url: string; filename: string } | null>(null)
  const [filesRemoved, setFilesRemoved] = useState(false)
  const [jobId, setJobId] = useState<string | null>(null)
  const [job, setJob] = useState<BulkStatus | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadPercent, setUploadPercent] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [pollVersion, setPollVersion] = useState(0)
  const [label, setLabel] = useState('')
  const [uncertainOnly, setUncertainOnly] = useState(false)
  const running = !!jobId && (!job || !isBulkTerminal(job.status))
  const disabled = uploading || running || busy
  const terminal = job ? isBulkTerminal(job.status) : false

  useEffect(() => {
    const downloads = urls.current
    return () => {
      requestRef.current?.abort()
      stopPolling.current?.()
      downloads.forEach((timer, url) => { clearTimeout(timer); URL.revokeObjectURL(url) })
      downloads.clear()
      previews.clear()
    }
  }, [previews])

  useEffect(() => {
    if (!active || !jobId || terminal) return
    const stop = pollBulkJob(jobId, (result) => {
      setJob(result)
      setError('')
      if (result.status === 'error') setError(result.error ?? 'Không thể hoàn tất phân loại. Vui lòng thử lại.')
    }, (reason) => setError(reason instanceof Error ? reason.message : 'Không thể tải tiến độ. Vui lòng thử lại.'))
    stopPolling.current = stop
    return () => { stop(); stopPolling.current = null }
  }, [active, jobId, terminal, pollVersion])

  function choose(selected: File[]) {
    if (disabled) return
    if (!selected.length) return
    previews.clear()
    setLightbox(null)
    setSubmittedFiles([])
    setJobId(null)
    setJob(null)
    setFilesRemoved(false)
    setFiles(selected)
    setError('')
    setLabel('')
    setUncertainOnly(false)
  }

  function showError(reason: unknown) {
    const message = reason instanceof Error ? reason.message : 'Không thể thực hiện. Vui lòng thử lại.'
    setError(message)
    toast.error(message)
  }

  async function start() {
    if (!files.length || disabled) return
    requestRef.current?.abort()
    const controller = new AbortController()
    requestRef.current = controller
    stopPolling.current?.()
    previews.clear()
    setLightbox(null)
    setSubmittedFiles([...files])
    setFilesRemoved(false)
    setUploading(true)
    setUploadPercent(0)
    setError('')
    setJobId(null)
    setJob(null)
    setLabel('')
    setUncertainOnly(false)
    try {
      const result = await createBulkJob(files, setUploadPercent, controller.signal)
      if (!controller.signal.aborted) setJobId(result.job_id)
    } catch (reason) {
      if (!controller.signal.aborted) showError(reason)
    } finally {
      if (!controller.signal.aborted) setUploading(false)
    }
  }

  async function cancel() {
    if (!jobId || busy) return
    stopPolling.current?.()
    setBusy(true)
    setError('')
    const controller = new AbortController()
    requestRef.current = controller
    try {
      const result = await cancelBulkJob(jobId, controller.signal)
      if (!controller.signal.aborted) {
        setJob(bulkStatusAfterRemoval(job, result))
        setFilesRemoved(true)
        setLightbox(null)
        previews.clear()
        setSubmittedFiles([])
        setFiles([])
      }
    } catch (reason) {
      if (!controller.signal.aborted) { showError(reason); setPollVersion((value) => value + 1) }
    } finally {
      if (!controller.signal.aborted) setBusy(false)
    }
  }

  async function download() {
    if (!jobId || busy || filesRemoved) return
    setBusy(true)
    setError('')
    const controller = new AbortController()
    requestRef.current = controller
    try {
      const blob = await downloadBulkJob(jobId, controller.signal)
      if (controller.signal.aborted) return
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = 'sportsnap_result.zip'
      document.body.append(anchor)
      anchor.click()
      anchor.remove()
      urls.current.set(url, setTimeout(() => { URL.revokeObjectURL(url); urls.current.delete(url) }, 1000))
    } catch (reason) {
      if (!controller.signal.aborted) showError(reason)
    } finally {
      if (!controller.signal.aborted) setBusy(false)
    }
  }

  const items = useMemo(() => filterBulkItems(pairBulkPreviewItems(job?.items ?? [], submittedFiles), label, uncertainOnly), [job?.items, submittedFiles, label, uncertainOnly])
  const progress = job?.total ? Math.round(job.processed / job.total * 100) : 0
  return (
    <>
      <header className="text-white">
        <p className="mb-3 flex items-center gap-2 text-xs font-semibold tracking-widest text-emerald-300 uppercase"><Layers size={16} aria-hidden="true" />Sắp xếp ảnh thể thao</p>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Phân loại hàng loạt</h1>
        <p className="mt-4 text-sm leading-relaxed text-slate-200 sm:text-base">Chọn nhiều ảnh hoặc một tệp ZIP. Nhận ảnh được chia theo môn thể thao cùng báo cáo kết quả.</p>
      </header>
      <Card className="hud-panel mt-8 space-y-5 p-4 sm:p-6">
        <input ref={inputRef} type="file" multiple accept=".jpg,.jpeg,.png,.webp,.zip,image/jpeg,image/png,image/webp,application/zip" className="sr-only" aria-label="Chọn ảnh hoặc ZIP" disabled={disabled}
          onChange={(event) => { choose(Array.from(event.target.files ?? [])); event.target.value = '' }} />
        <div onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); choose(Array.from(event.dataTransfer.files)) }}>
          <button type="button" disabled={disabled} onClick={() => inputRef.current?.click()} className="flex min-h-44 w-full flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-primary/35 bg-primary/5 p-5 text-center transition-colors hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-60">
            <Upload className="text-primary" size={28} aria-hidden="true" />
            <span className="font-medium">Kéo thả hoặc bấm để chọn tệp</span>
            <span className="text-sm text-muted-foreground">JPG, PNG, WebP hoặc một ZIP chứa ảnh</span>
          </button>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground" aria-live="polite">{files.length ? (files.length === 1 && files[0].name.toLowerCase().endsWith('.zip') ? `Đã chọn ZIP: ${files[0].name}` : `Đã chọn ${files.length} tệp`) : 'Chưa có tệp nào được chọn.'}</p>
          <Button disabled={!files.length || disabled} onClick={() => { void start() }}><Layers size={18} aria-hidden="true" />Bắt đầu</Button>
        </div>
        {uploading && <div className="space-y-3" role="status"><p className="text-sm">{uploadPercent === 100 ? 'Đang chuẩn bị lượt phân loại…' : `Đang tải tệp lên: ${uploadPercent}%`}</p><Progress value={uploadPercent} label="Tiến độ tải lên" /></div>}
        {error && <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm"><p>{error}</p>{running && <Button className="mt-3" variant="outline" onClick={() => { setError(''); setPollVersion((value) => value + 1) }}>Thử lại</Button>}</div>}
        {running && !job && <Button variant="outline" disabled={busy} onClick={() => { void cancel() }}><X size={18} aria-hidden="true" />Hủy</Button>}
      </Card>
      {jobId && !job && !error && <Card className="mt-5 space-y-3 p-5" aria-label="Đang tải tiến độ"><Skeleton className="h-5 w-40" /><Skeleton className="h-3 w-full" /></Card>}
      {job && <Card className="mt-5 space-y-5 p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-lg font-semibold">{running && <LoaderCircle size={18} className="motion-safe:animate-spin" aria-hidden="true" />}{stateLabels[job.status]}</h2>
          <p className="text-sm tabular-nums" aria-live="polite">{job.processed} / {job.total} tệp</p>
        </div>
        <Progress value={progress} label="Tiến độ phân loại" />
        <div className="flex flex-wrap gap-2 text-sm">
          {Object.entries(job.counts).map(([sport, count]) => <span key={sport} className="rounded-lg bg-primary/10 px-3 py-2">{sport}: <strong className="tabular-nums">{count}</strong></span>)}
          <span className="rounded-lg bg-amber-500/15 px-3 py-2">Không chắc chắn: {job.uncertain}</span>
          <span className="rounded-lg bg-muted px-3 py-2">Tệp lỗi: {job.errors}</span>
        </div>
        <p className="text-xs text-muted-foreground">Xem trước tối đa 50 kết quả đầu tiên. Báo cáo trong ZIP chứa tất cả kết quả.</p>
        <div className="flex flex-wrap items-center gap-4">
          <label className="text-sm">Môn thể thao<select value={label} onChange={(event) => { setLightbox(null); setLabel(event.target.value) }} className="ml-2 min-h-11 max-w-48 rounded-xl border bg-background px-3"><option value="">Tất cả</option>{Object.keys(job.counts).map((sport) => <option key={sport} value={sport}>{sport}</option>)}</select></label>
          <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={uncertainOnly} onChange={(event) => { setLightbox(null); setUncertainOnly(event.target.checked) }} className="size-4 accent-emerald-600" />Chỉ không chắc chắn</label>
        </div>
        <div className="overflow-x-auto rounded-xl border">
          <table className="block w-full text-left text-sm sm:table"><caption className="sr-only">Kết quả phân loại xem trước</caption><thead className="hidden bg-muted/60 sm:table-header-group"><tr><th scope="col" className="p-3">Ảnh</th><th scope="col" className="p-3">Tên tệp</th><th scope="col" className="p-3">Nhãn / trạng thái</th><th scope="col" className="p-3">Độ tin cậy</th></tr></thead>
            <tbody className="block sm:table-row-group">{items.map((item) => <tr key={`${jobId}:${item.index}`} className="grid grid-cols-[96px_minmax(0,1fr)] border-t p-1 first:border-t-0 sm:table-row sm:p-0 sm:first:border-t">
              <td className="row-span-3 p-3 align-top">{item.file ? <BulkThumbnail file={item.file} index={item.index} filename={item.filename} previews={previews} onOpen={(url, filename) => setLightbox({ url, filename })} /> : <span className="flex size-[72px] items-center justify-center rounded-xl bg-muted p-1 text-center text-xs text-muted-foreground">Không có ảnh xem trước</span>}</td>
              <td className="min-w-0 max-w-56 break-all px-3 pt-3 pb-1 sm:p-3">{item.filename}</td>
              <td className="min-w-0 px-3 py-1 sm:p-3">{item.error ? <span className="text-destructive">{fileErrors[item.error] ?? 'Không đọc được tệp'}</span> : <><span>{item.label}</span>{item.is_uncertain && <span className="mt-1 block w-fit rounded-full bg-amber-500/15 px-2 py-1 text-xs text-amber-800 dark:text-amber-300">Không chắc chắn</span>}</>}</td>
              <td className="px-3 pt-1 pb-3 tabular-nums sm:p-3"><span className="text-muted-foreground sm:hidden">Độ tin cậy: </span>{item.confidence === null ? '—' : `${(item.confidence * 100).toFixed(1)}%`}</td>
            </tr>)}</tbody>
          </table>
          {!items.length && <p className="p-6 text-center text-sm text-muted-foreground">{running && !job.processed ? 'Kết quả sẽ xuất hiện khi ảnh được xử lý.' : 'Không có kết quả phù hợp bộ lọc.'}</p>}
        </div>
        {submittedFiles.length === 1 && submittedFiles[0].name.toLowerCase().endsWith('.zip') && <p className="text-xs text-muted-foreground">Ảnh trong ZIP không có bản xem trước. Chọn trực tiếp các tệp ảnh để xem thumbnail.</p>}
        {filesRemoved && <p role="status" className="text-sm text-muted-foreground">Đã xóa tệp tạm. Kết quả tổng hợp vẫn được giữ trên trang này.</p>}
        <div className="flex flex-wrap gap-3">
          {job.status === 'done' && !filesRemoved && <Button disabled={busy} onClick={() => { void download() }}><Download size={18} aria-hidden="true" />{busy ? 'Đang tải…' : 'Tải ZIP'}</Button>}
          {job.status !== 'cancelled' && !filesRemoved && <Button variant="outline" disabled={busy} onClick={() => { void cancel() }}><X size={18} aria-hidden="true" />{running ? 'Hủy' : 'Xóa tệp tạm'}</Button>}
        </div>
      </Card>}
      {active && lightbox && <BulkLightbox url={lightbox.url} filename={lightbox.filename} onClose={() => setLightbox(null)} />}
    </>
  )
}
