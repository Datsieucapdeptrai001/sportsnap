import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Download, ImageOff, Layers, LoaderCircle, RotateCcw, Upload, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { Progress } from '../components/ui/progress'
import { Skeleton } from '../components/ui/skeleton'
import { SportArButton } from '../components/sport-ar-button'
import { ConfidenceLanes } from '../components/confidence-lanes'
import { cn } from '../lib/utils'
import { sportNameVi } from '../lib/sport-names'
import { cancelBulkJob, createBulkJob, downloadBulkJob, getBulkImageUrl, getBulkResults, getBulkThumbnailUrl, type BulkResultItem, type BulkResults, type BulkSort, type BulkState, type BulkStatus } from '../lib/api'
import { BULK_PAGE_SIZE, bulkPagination, bulkResultsQuery, bulkStatusAfterRemoval, changeBulkFilters, initialBulkView, isBulkTerminal, moveBulkLightbox, pollBulkJob, toggleBulkLabel } from '../lib/bulk'

const stateLabels: Record<BulkState, string> = {
  queued: 'Đang chờ', running: 'Đang phân loại', done: 'Đã hoàn tất', error: 'Phân loại thất bại', cancelled: 'Đã hủy',
}
const percent = new Intl.NumberFormat('vi-VN', { style: 'percent', maximumFractionDigits: 1 })
const fileErrors: Record<string, string> = {
  unsupported_format: 'Định dạng không hỗ trợ', corrupt: 'Ảnh hỏng hoặc không đọc được', too_large: 'Vượt dung lượng cho phép',
}

function BulkImage({ src, filename, large = false }: { src: string; filename: string; large?: boolean }) {
  const [failed, setFailed] = useState(false)
  return failed ? (
    <span className="flex min-h-32 w-full flex-col items-center justify-center gap-2 bg-lane p-3 text-center text-xs text-muted-foreground"><ImageOff size={24} aria-hidden="true" />Không thể xem ảnh này</span>
  ) : <img src={src} alt={filename} loading={large ? 'eager' : 'lazy'} decoding="async" onError={() => setFailed(true)} className={large ? 'mx-auto max-h-[55svh] max-w-full rounded-xl object-contain' : 'size-full object-cover'} />
}

function UncertainBadge() {
  return <span className="inline-block rounded-full border border-warning-line bg-warning-surface px-2 py-0.5 text-[11px] font-medium text-warning">Không chắc chắn</span>
}

function BulkLightbox({ jobId, item, items, onChange, onClose }: {
  jobId: string; item: BulkResultItem; items: BulkResultItem[]
  onChange: (index: number | null) => void; onClose: () => void
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = dialogRef.current
    dialog?.showModal()
    return () => dialog?.close()
  }, [])
  function close() { dialogRef.current?.close(); onClose() }
  function move(direction: -1 | 1) { onChange(moveBulkLightbox(items, item.index, direction)) }
  const position = items.findIndex((entry) => entry.index === item.index)
  return (
    <dialog ref={dialogRef} aria-label={`Xem ảnh ${item.filename}`} className="fixed inset-0 m-auto max-h-[95svh] w-[calc(100%_-_1rem)] max-w-3xl overflow-y-auto rounded-xl border border-border bg-card p-4 text-card-foreground shadow-2xl backdrop:bg-black/75 sm:p-6"
      onCancel={(event) => { event.preventDefault(); close() }}
      onClick={(event) => { if (event.target === event.currentTarget) close() }}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); move(event.key === 'ArrowLeft' ? -1 : 1) }
      }}>
      <div className="mb-4 flex items-center justify-between gap-3"><h2 className="min-w-0 break-all text-sm font-medium text-muted-foreground">{item.filename}</h2><Button autoFocus variant="outline" className="size-11 shrink-0 p-0" aria-label="Đóng ảnh" onClick={close}><X size={20} aria-hidden="true" /></Button></div>
      <BulkImage key={item.index} src={getBulkImageUrl(jobId, item.index)} filename={item.filename} large />
      <div className="mt-4 flex items-center justify-between gap-3">
        <Button variant="outline" disabled={items.length < 2} aria-label="Ảnh trước" onClick={() => move(-1)}><ChevronLeft size={20} aria-hidden="true" /></Button>
        <p className="text-center text-sm tabular-nums">Ảnh {position + 1} / {items.length} trong trang</p>
        <Button variant="outline" disabled={items.length < 2} aria-label="Ảnh sau" onClick={() => move(1)}><ChevronRight size={20} aria-hidden="true" /></Button>
      </div>
      <div className="mt-4 space-y-3">
        {item.error ? <p className="text-sm text-destructive">{fileErrors[item.error] ?? 'Không đọc được tệp'}</p> : <>
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <p className="text-2xl font-bold tracking-tight capitalize">{item.label ? `${sportNameVi(item.label)} (${item.label})` : ''}</p>
            <p className={cn('text-xl font-semibold tabular-nums', item.is_uncertain ? 'text-warning' : 'text-primary')}>{percent.format(item.confidence ?? 0)}</p>
          </div>
          {item.is_uncertain && <p><UncertainBadge /></p>}
          <h3 className="pt-2 text-sm font-semibold">Ba dự đoán hàng đầu</h3>
          <ConfidenceLanes predictions={item.top3} uncertain={item.is_uncertain} />
          <SportArButton key={item.index} label={item.label ?? ''} confidence={item.confidence ?? undefined} isUncertain={item.is_uncertain} />
        </>}
      </div>
    </dialog>
  )
}

interface ResultsState { requestKey: string; queryKey: string; data: BulkResults | null; error: string }

export function BulkPage({ active }: { active: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const requestRef = useRef<AbortController | null>(null)
  const resultsRequestRef = useRef<AbortController | null>(null)
  const stopPolling = useRef<(() => void) | null>(null)
  const urls = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const [files, setFiles] = useState<File[]>([])
  const [jobId, setJobId] = useState<string | null>(null)
  const [job, setJob] = useState<BulkStatus | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadPercent, setUploadPercent] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [retryVersion, setRetryVersion] = useState(0)
  const [filesRemoved, setFilesRemoved] = useState(false)
  const [view, setView] = useState(initialBulkView)
  const [resultsState, setResultsState] = useState<ResultsState | null>(null)
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)
  const [startTime, setStartTime] = useState<number | null>(null)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const removed = filesRemoved || !!job?.files_removed
  const terminal = job ? isBulkTerminal(job.status) : false
  const running = !!jobId && !terminal
  const disabled = uploading || running || busy
  const queryKey = JSON.stringify([jobId, view])
  const requestKey = JSON.stringify([queryKey, job?.processed, job?.status, retryVersion])
  const results = resultsState?.queryKey === queryKey ? resultsState.data : null
  const resultsError = resultsState?.requestKey === requestKey ? resultsState.error : ''
  const loading = !!jobId && !removed && resultsState?.requestKey !== requestKey

  useEffect(() => {
    const downloads = urls.current
    return () => {
      requestRef.current?.abort()
      resultsRequestRef.current?.abort()
      stopPolling.current?.()
      downloads.forEach((timer, url) => { clearTimeout(timer); URL.revokeObjectURL(url) })
      downloads.clear()
    }
  }, [])

  useEffect(() => {
    if (!active || !jobId || terminal) return
    const stop = pollBulkJob(jobId, (result) => {
      setJob(result)
      setError(result.status === 'error' ? result.error ?? 'Không thể hoàn tất phân loại. Vui lòng thử lại.' : '')
    }, (reason) => setError(reason instanceof Error ? reason.message : 'Không thể tải tiến độ. Vui lòng thử lại.'))
    stopPolling.current = stop
    return () => { stop(); stopPolling.current = null }
  }, [active, jobId, terminal, retryVersion])

  useEffect(() => {
    if (!active || !jobId || removed) return
    const controller = new AbortController()
    resultsRequestRef.current = controller
    getBulkResults(jobId, bulkResultsQuery(view), controller.signal).then((data) => {
      if (!controller.signal.aborted) {
        setResultsState({ requestKey, queryKey, data, error: '' })
        setLightboxIndex((index) => index !== null && !data.items.some((item) => item.index === index) ? null : index)
      }
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setResultsState({ requestKey, queryKey, data: null, error: reason instanceof Error ? reason.message : 'Không thể tải kết quả. Vui lòng thử lại.' })
    })
    return () => controller.abort()
  }, [active, jobId, removed, requestKey, queryKey, view])

  useEffect(() => {
    if (!running || !startTime) return
    const timer = window.setInterval(() => {
      setElapsedSeconds(Math.max(1, Math.round((Date.now() - startTime) / 1000)))
    }, 500)
    return () => window.clearInterval(timer)
  }, [running, startTime])

  function resetResults() {
    resultsRequestRef.current?.abort()
    setResultsState(null)
    setView(initialBulkView)
    setLightboxIndex(null)
    setFilesRemoved(false)
    setStartTime(null)
    setElapsedSeconds(0)
  }

  function choose(selected: File[]) {
    if (disabled || !selected.length) return
    resetResults()
    setJobId(null)
    setJob(null)
    setFiles(selected)
    setError('')
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
    resetResults()
    setUploading(true)
    setUploadPercent(0)
    setError('')
    setJobId(null)
    setJob(null)
    setStartTime(Date.now())
    setElapsedSeconds(0)
    try {
      const result = await createBulkJob(files, setUploadPercent, controller.signal)
      if (!controller.signal.aborted) setJobId(result.job_id)
    } catch (reason) {
      if (!controller.signal.aborted) showError(reason)
    } finally {
      if (!controller.signal.aborted) setUploading(false)
    }
  }

  async function removeJob() {
    if (!jobId || busy || removed) return
    stopPolling.current?.()
    resultsRequestRef.current?.abort()
    setBusy(true)
    setError('')
    const controller = new AbortController()
    requestRef.current = controller
    try {
      const result = await cancelBulkJob(jobId, controller.signal)
      if (!controller.signal.aborted) {
        setJob(bulkStatusAfterRemoval(job, result))
        setFilesRemoved(true)
        setLightboxIndex(null)
        setFiles([])
      }
    } catch (reason) {
      if (!controller.signal.aborted) { showError(reason); setRetryVersion((value) => value + 1) }
    } finally {
      if (!controller.signal.aborted) setBusy(false)
    }
  }

  async function download() {
    if (!jobId || busy || removed) return
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

  const summary = results && results.summary.processed >= (job?.processed ?? 0) ? results.summary : job
  const items = results?.items ?? []
  const selectedItem = items.find((item) => item.index === lightboxIndex)
  const pagination = bulkPagination(results?.total ?? 0, view.page)
  const progress = job?.total ? Math.round(job.processed / job.total * 100) : 0
  function goToPage(page: number) { setLightboxIndex(null); setView({ ...view, page }) }

  return (
    <>
      <header>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Phân loại hàng loạt</h1>
        <p className="mt-2 max-w-prose text-sm leading-relaxed text-muted-foreground sm:text-base">Chọn nhiều ảnh hoặc một ZIP. Ảnh được xếp vào từng môn, và bạn có thể tải về bộ ảnh đã sắp xếp.</p>
      </header>
      <Card className="mt-5 space-y-5 p-4 sm:p-6">
        <input ref={inputRef} type="file" multiple accept=".jpg,.jpeg,.png,.webp,.zip,image/jpeg,image/png,image/webp,application/zip" className="sr-only" aria-label="Chọn ảnh hoặc ZIP" disabled={disabled}
          onChange={(event) => { choose(Array.from(event.target.files ?? [])); event.target.value = '' }} />
        <div onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); choose(Array.from(event.dataTransfer.files)) }}>
          <button type="button" disabled={disabled} onClick={() => inputRef.current?.click()} className="court-box flex min-h-44 w-full flex-col items-center justify-center gap-2 rounded-xl bg-lane p-6 text-center [--court-color:var(--primary)] transition-colors hover:bg-primary-soft disabled:cursor-not-allowed disabled:opacity-60">
            <Upload className="mb-1 text-primary" size={30} strokeWidth={1.5} aria-hidden="true" /><span className="text-base font-semibold">Kéo thả hoặc bấm để chọn tệp</span><span className="text-sm text-muted-foreground">JPG, PNG, WebP hoặc một ZIP chứa ảnh</span>
          </button>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3"><p className="min-w-0 break-all text-sm text-muted-foreground" aria-live="polite">{files.length ? (files.length === 1 && files[0].name.toLowerCase().endsWith('.zip') ? `Đã chọn ZIP: ${files[0].name}` : `Đã chọn ${files.length} tệp`) : 'Chưa có tệp nào được chọn.'}</p><Button disabled={!files.length || disabled} onClick={() => { void start() }}><Layers size={18} aria-hidden="true" />Bắt đầu phân loại</Button></div>
        {uploading && <div className="space-y-3" role="status"><p className="text-sm">{uploadPercent === 100 ? 'Đang chuẩn bị lượt phân loại…' : `Đang tải tệp lên: ${uploadPercent}%`}</p><Progress value={uploadPercent} label="Tiến độ tải lên" /></div>}
        {error && <div role="alert" className="rounded-xl border border-destructive/50 bg-destructive-surface p-4 text-sm"><p>{error}</p>{running && <Button className="mt-3" variant="outline" onClick={() => { setError(''); setRetryVersion((value) => value + 1) }}><RotateCcw size={18} aria-hidden="true" />Thử lại</Button>}</div>}
        {running && !job && <Button variant="outline" disabled={busy} onClick={() => { void removeJob() }}><X size={18} aria-hidden="true" />Hủy</Button>}
      </Card>
      {jobId && !job && !error && <Card className="mt-5 space-y-3 p-5" aria-label="Đang tải tiến độ"><Skeleton className="h-5 w-40" /><Skeleton className="h-3 w-full" /></Card>}
      {job && summary && <Card className="mt-5 space-y-5 p-3 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-lg font-semibold">{running && <LoaderCircle size={18} className="motion-safe:animate-spin" aria-hidden="true" />}{stateLabels[job.status]}</h2>
          <div className="flex flex-wrap items-center gap-3 text-xs sm:text-sm tabular-nums text-muted-foreground" aria-live="polite">
            {elapsedSeconds > 0 && <span>Thời gian: <strong className="text-foreground">{elapsedSeconds}s</strong></span>}
            {elapsedSeconds > 0 && job.processed > 0 && <span>Tốc độ: <strong className="text-foreground">{(job.processed / elapsedSeconds).toFixed(1)} ảnh/s</strong></span>}
            <span>{job.processed} / {job.total} tệp</span>
          </div>
        </div>
        <dl className="grid grid-cols-2 overflow-hidden rounded-xl border border-border bg-border gap-px sm:grid-cols-4">{([['Tổng ảnh', summary.total, ''], ['Đã phân loại', summary.processed, ''], ['Không chắc chắn', summary.uncertain, 'text-warning'], ['Tệp lỗi', summary.errors, 'text-destructive']] as const).map(([title, count, tone]) => <div key={title} className="bg-card p-3"><dt className="text-xs text-muted-foreground">{title}</dt><dd className={cn('mt-1 text-2xl font-semibold tabular-nums', count ? tone : '')}>{count}</dd></div>)}</dl>
        <Progress value={progress} label="Tiến độ phân loại" />
        {removed ? <p role="status" className="rounded-xl border border-border bg-lane p-4 text-sm">Đã xóa tệp tạm. Kết quả tổng hợp vẫn được giữ trên trang này.</p> : <>
          <div className="sticky top-0 z-20 -mx-3 space-y-3 border-y border-border bg-card/95 px-3 py-3 backdrop-blur-md sm:-mx-5 sm:px-5">
            <div className="flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Lọc theo môn thể thao">
              <Button variant={!view.label && !view.uncertain ? 'default' : 'outline'} className="shrink-0 rounded-full" aria-pressed={!view.label && !view.uncertain} onClick={() => { setLightboxIndex(null); setView(changeBulkFilters(view, { label: '', uncertain: false })) }}>Tất cả <span className="tabular-nums opacity-80">{summary.processed}</span></Button>
              {summary.uncertain > 0 && (
                <Button
                  variant={view.uncertain ? 'default' : 'outline'}
                  className={cn('shrink-0 rounded-full', view.uncertain ? 'border-amber-400 bg-amber-500 font-semibold text-slate-950 hover:bg-amber-400' : 'border-amber-400/50 text-amber-300 hover:bg-amber-400/10')}
                  aria-pressed={view.uncertain}
                  onClick={() => { setLightboxIndex(null); setView(changeBulkFilters(view, { uncertain: !view.uncertain, label: '' })) }}
                >
                  ⚠️ Cần kiểm tra <span className="tabular-nums opacity-80">{summary.uncertain}</span>
                </Button>
              )}
              {Object.entries(summary.counts).map(([label, count]) => (
                <Button key={label} title={label} variant={view.label === label ? 'default' : 'outline'} className="shrink-0 rounded-full" aria-pressed={view.label === label} onClick={() => { setLightboxIndex(null); setView(toggleBulkLabel(view, label)) }}>
                  {sportNameVi(label)} <span className="tabular-nums opacity-80">{count}</span>
                </Button>
              ))}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="flex items-center gap-2 text-sm">Sắp xếp<select aria-label="Sắp xếp kết quả" value={view.sort} onChange={(event) => { setLightboxIndex(null); setView(changeBulkFilters(view, { sort: event.target.value as BulkSort })) }} className="min-h-11 max-w-48 rounded-xl border border-border bg-card px-2"><option value="confidence_desc">Tin cậy cao trước</option><option value="confidence_asc">Tin cậy thấp trước</option><option value="filename">Tên tệp A–Z</option></select></label>
              <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={view.uncertain} onChange={(event) => { setLightboxIndex(null); setView(changeBulkFilters(view, { uncertain: event.target.checked })) }} className="size-5 accent-[var(--primary)]" />Chỉ không chắc chắn</label>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {job.status === 'done' && <Button disabled={busy} onClick={() => { void download() }}><Download size={18} aria-hidden="true" />{busy ? 'Đang tải…' : 'Tải ZIP'}</Button>}
              <Button variant="outline" disabled={busy} onClick={() => { void removeJob() }}><X size={18} aria-hidden="true" />{running ? 'Hủy' : 'Xóa tệp tạm'}</Button>
              <span className="text-xs text-muted-foreground" aria-live="polite">{results ? `${results.total} kết quả phù hợp` : 'Đang tải kết quả…'}{loading && results ? ', đang cập nhật…' : ''}</span>
            </div>
          </div>
          {resultsError && <div role="alert" className="space-y-3 rounded-xl border border-destructive/50 bg-destructive-surface p-4 text-sm"><p>{resultsError}</p><Button variant="outline" onClick={() => setRetryVersion((value) => value + 1)}><RotateCcw size={18} aria-hidden="true" />Thử lại</Button></div>}
          {loading && !results && <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-5" aria-label="Đang tải kết quả">{Array.from({ length: BULK_PAGE_SIZE }, (_, index) => <Skeleton key={index} className="aspect-[3/4] w-full" />)}</div>}
          {results && <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-5" aria-label="Kết quả phân loại">
              {items.map((item) => <button key={`${jobId}:${item.index}`} type="button" onClick={() => setLightboxIndex(item.index)} aria-label={`Xem ảnh ${item.filename}`} className={cn('min-w-0 overflow-hidden rounded-xl border bg-card text-left transition-colors hover:border-foreground/40', item.is_uncertain ? 'border-warning-line' : 'border-border')}>
                <div className="aspect-square overflow-hidden bg-lane"><BulkImage src={getBulkThumbnailUrl(jobId!, item.index)} filename={item.filename} /></div>
                <div className="space-y-2 p-2.5"><p className="truncate text-[11px] text-muted-foreground" title={item.filename}>{item.filename}</p>{item.error ? <p className="text-xs text-destructive">{fileErrors[item.error] ?? 'Không đọc được tệp'}</p> : <><div className="flex items-baseline justify-between gap-2"><p className="min-w-0 break-words text-sm leading-snug font-semibold" title={item.label ?? undefined}>{item.label ? sportNameVi(item.label) : ''}</p><p className="shrink-0 text-xs tabular-nums">{percent.format(item.confidence ?? 0)}</p></div><Progress value={(item.confidence ?? 0) * 100} label={`Độ tin cậy của ${item.filename}`} className={item.is_uncertain ? 'bg-warning-bar' : undefined} />{item.is_uncertain && <UncertainBadge />}</>}</div>
              </button>)}
            </div>
            {!items.length && <p className="py-10 text-center text-sm text-muted-foreground">{running && !job.processed ? 'Kết quả sẽ xuất hiện khi ảnh được xử lý.' : 'Không có ảnh phù hợp bộ lọc.'}</p>}
            <nav className="flex flex-wrap items-center justify-center gap-1.5" aria-label="Phân trang kết quả">
              <Button variant="outline" className="px-2" aria-label="Trang trước" disabled={view.page <= 1} onClick={() => goToPage(view.page - 1)}><ChevronLeft size={18} aria-hidden="true" /></Button>
              {pagination.numbers.map((page) => <Button key={page} variant={page === view.page ? 'default' : 'outline'} className="min-w-11 px-2" aria-current={page === view.page ? 'page' : undefined} aria-label={`Trang ${page}`} onClick={() => goToPage(page)}>{page}</Button>)}
              <Button variant="outline" className="px-2" aria-label="Trang sau" disabled={view.page >= pagination.pages} onClick={() => goToPage(view.page + 1)}><ChevronRight size={18} aria-hidden="true" /></Button>
              <span className="w-full text-center text-xs text-muted-foreground">Trang {pagination.page} / {pagination.pages}</span>
            </nav>
          </>}
        </>}
      </Card>}
      {active && jobId && selectedItem && !removed && <BulkLightbox jobId={jobId} item={selectedItem} items={items} onChange={setLightboxIndex} onClose={() => setLightboxIndex(null)} />}
    </>
  )
}
