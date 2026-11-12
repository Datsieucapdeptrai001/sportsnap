import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import {
  CheckCircle2,
  CopyCheck,
  Database,
  FolderUp,
  History,
  ImagePlus,
  LoaderCircle,
  Search,
  Sparkles,
  Tag,
  Trash2,
  Upload,
} from 'lucide-react'
import { toast } from 'sonner'
import { SportLabel } from '../components/sport-label'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { Progress } from '../components/ui/progress'
import {
  decideLibraryDedupGroup,
  deleteLibraryImage,
  getLibraryDedupGroups,
  getLibraryJob,
  getLibraryModelVersions,
  getLibraryReviewQueue,
  getLibraryStats,
  ingestLibraryFiles,
  ingestLibraryFolder,
  promoteLibraryModelVersion,
  runLibraryDedup,
  searchLibrary,
  searchSimilarByFile,
  searchSimilarById,
  setLibraryImageLabel,
  triggerLibraryRetrain,
  type DedupGroup,
  type DedupSummary,
  type LibraryJob,
  type LibrarySearchItem,
  type LibraryStats,
  type ModelVersionInfo,
  type ReviewItem,
} from '../lib/api'
import { sportNameVi } from '../lib/sport-names'
import { cn } from '../lib/utils'

const pct = new Intl.NumberFormat('vi-VN', { style: 'percent', maximumFractionDigits: 1 })

const EXAMPLE_QUERIES = [
  'bắn cung',
  'vận động viên bơi lội',
  'bóng đá trên sân cỏ',
  'formula 1 racing car',
  'basketball dunk',
]

export function LibraryPage({ active }: { active: boolean }) {
  const [subTab, setSubTab] = useState<'search' | 'dedup' | 'mlops'>('search')
  const [stats, setStats] = useState<LibraryStats | null>(null)
  const [folder, setFolder] = useState('datasets/anh-ngoai')
  const [activeJob, setActiveJob] = useState<LibraryJob | null>(null)
  const uploadInputRef = useRef<HTMLInputElement>(null)
  const similarInputRef = useRef<HTMLInputElement>(null)

  // Search state
  const [query, setQuery] = useState('')
  const [expandedQuery, setExpandedQuery] = useState('')
  const [filterLabel, setFilterLabel] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [searching, setSearching] = useState(false)
  const [items, setItems] = useState<LibrarySearchItem[]>([])
  const [totalItems, setTotalItems] = useState(0)

  // Dedup state
  const [dedupRunning, setDedupRunning] = useState(false)
  const [dedupSummary, setDedupSummary] = useState<DedupSummary | null>(null)
  const [dupGroups, setDupGroups] = useState<DedupGroup[]>([])

  // MLOps state
  const [reviewItems, setReviewItems] = useState<ReviewItem[]>([])
  const [availableLabels, setAvailableLabels] = useState<string[]>([])
  const [includeAllReview, setIncludeAllReview] = useState(false)
  const [versions, setVersions] = useState<ModelVersionInfo[]>([])
  const [retraining, setRetraining] = useState(false)

  const refreshStats = useCallback(async () => {
    try {
      const next = await getLibraryStats()
      setStats(next)
    } catch {
      // Initial stats can wait for manual actions
    }
  }, [])

  const runSearch = useCallback(async (overrideQuery?: string) => {
    setSearching(true)
    try {
      const qVal = overrideQuery !== undefined ? overrideQuery : query
      const res = await searchLibrary({
        q: qVal,
        label: filterLabel || undefined,
        status: filterStatus || undefined,
        limit: 36,
      })
      setItems(res.items)
      setTotalItems(res.total)
      setExpandedQuery(res.expanded_query)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Tìm kiếm thất bại.')
    } finally {
      setSearching(false)
    }
  }, [filterLabel, filterStatus, query])

  const loadDedup = useCallback(async () => {
    try {
      const res = await getLibraryDedupGroups()
      setDupGroups(res.groups)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Không tải được nhóm trùng.')
    }
  }, [])

  const loadMlops = useCallback(async () => {
    try {
      const [rev, ver] = await Promise.all([
        getLibraryReviewQueue(includeAllReview),
        getLibraryModelVersions(),
      ])
      setReviewItems(rev.items)
      setAvailableLabels(rev.labels)
      setVersions(ver.versions)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Không tải được dữ liệu MLOps.')
    }
  }, [includeAllReview])

  useEffect(() => {
    if (!active) return
    void refreshStats()
    if (subTab === 'search') void runSearch()
    else if (subTab === 'dedup') void loadDedup()
    else void loadMlops()
  }, [active, subTab, refreshStats, runSearch, loadDedup, loadMlops])

  // Poll active background ingest/retrain job
  useEffect(() => {
    if (!activeJob || activeJob.state === 'done' || activeJob.state === 'error') return
    const timer = window.setInterval(async () => {
      try {
        const next = await getLibraryJob(activeJob.id)
        setActiveJob(next)
        if (next.state === 'done') {
          toast.success(next.message ?? 'Đã hoàn tất tác vụ!')
          setRetraining(false)
          void refreshStats()
          if (subTab === 'search') void runSearch()
          if (subTab === 'mlops') void loadMlops()
        } else if (next.state === 'error') {
          toast.error(next.error ?? next.message ?? 'Tác vụ thất bại.')
          setRetraining(false)
        }
      } catch {
        // Retry next tick
      }
    }, 800)
    return () => window.clearInterval(timer)
  }, [activeJob, refreshStats, runSearch, loadMlops, subTab])

  async function handleIngestFolder(event: FormEvent) {
    event.preventDefault()
    if (!folder.trim()) return
    try {
      const { job_id } = await ingestLibraryFolder(folder.trim())
      setActiveJob({ id: job_id, type: 'ingest', state: 'queued', progress: 0, message: 'Đang chuẩn bị nạp ảnh...', error: null })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Không thể nạp thư mục.')
    }
  }

  async function handleUploadIngest(event: ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (!selected.length) return
    try {
      const { job_id } = await ingestLibraryFiles(selected)
      setActiveJob({ id: job_id, type: 'ingest', state: 'queued', progress: 0, message: `Đang nạp ${selected.length} ảnh...`, error: null })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Không thể tải ảnh lên.')
    }
  }

  async function handleSimilarByFile(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0]
    event.target.value = ''
    if (!selected) return
    setSearching(true)
    try {
      const res = await searchSimilarByFile(selected)
      setItems(res.items)
      setTotalItems(res.items.length)
      setExpandedQuery(`Tìm ảnh tương tự: ${selected.name}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Không thể tìm ảnh tương tự.')
    } finally {
      setSearching(false)
    }
  }

  async function handleRunDedup() {
    setDedupRunning(true)
    try {
      const summary = await runLibraryDedup()
      setDedupSummary(summary)
      await loadDedup()
      await refreshStats()
      toast.success(`Tìm thấy ${summary.num_groups} nhóm trùng (giảm ${pct.format(summary.reduction_rate)} ảnh).`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Lỗi quét ảnh trùng.')
    } finally {
      setDedupRunning(false)
    }
  }

  async function handleRetrain() {
    setRetraining(true)
    try {
      const { job_id } = await triggerLibraryRetrain(3, true)
      setActiveJob({ id: job_id, type: 'retrain', state: 'queued', progress: 0, message: 'Đang khởi chạy huấn luyện lại...', error: null })
    } catch (error) {
      setRetraining(false)
      toast.error(error instanceof Error ? error.message : 'Không thể huấn luyện lại.')
    }
  }

  return (
    <>
      <header className="text-white">
        <p className="mb-3 flex items-center gap-2 text-xs font-semibold tracking-widest text-emerald-300 uppercase">
          <Database size={16} aria-hidden="true" />Thư viện ảnh thông minh · CLIP &amp; MLOps
        </p>
        <h1 className="text-3xl leading-tight font-semibold tracking-tight sm:text-4xl">
          Tìm kiếm ngữ nghĩa, lọc trùng &amp; cải thiện mô hình
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-slate-200 sm:text-base">
          Đánh chỉ mục thư viện ảnh bằng ResNet50 + CLIP ViT-B/32, tìm kiếm bằng ngôn ngữ tự nhiên, chọn ảnh đẹp nhất trong cụm trùng và huấn luyện lại từ nhãn sửa.
        </p>
      </header>

      {/* Stats + Ingestion bar */}
      <Card className="hud-panel mt-6 p-4 sm:p-5">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-xl border border-border/70 bg-background/40 p-3">
            <p className="text-xs text-muted-foreground">Ảnh đã nạp</p>
            <p className="mt-1 text-xl font-bold tabular-nums">{stats?.total_images ?? 0}</p>
          </div>
          <div className="rounded-xl border border-border/70 bg-background/40 p-3">
            <p className="text-xs text-muted-foreground">Vector CLIP</p>
            <p className="mt-1 text-xl font-bold tabular-nums">{stats?.index_size ?? 0}</p>
          </div>
          <div className="rounded-xl border border-border/70 bg-background/40 p-3">
            <p className="text-xs text-muted-foreground">Nhóm ảnh trùng</p>
            <p className="mt-1 text-xl font-bold tabular-nums">{stats?.total_dup_groups ?? 0}</p>
          </div>
          <div className="rounded-xl border border-border/70 bg-background/40 p-3">
            <p className="text-xs text-muted-foreground">Nhãn người sửa</p>
            <p className="mt-1 text-xl font-bold tabular-nums">{stats?.human_labels ?? 0}</p>
          </div>
        </div>

        <form onSubmit={(e) => void handleIngestFolder(e)} className="mt-4 flex flex-col gap-2 sm:flex-row">
          <input
            type="text"
            value={folder}
            onChange={(e) => setFolder(e.target.value)}
            placeholder="Đường dẫn thư mục trong dự án (vd: datasets/anh-ngoai)"
            className="min-h-11 flex-1 rounded-xl border border-border bg-background/80 px-3 text-sm"
          />
          <Button type="submit" disabled={activeJob?.state === 'running'}>
            <FolderUp size={17} aria-hidden="true" />Nạp thư mục
          </Button>
          <input
            ref={uploadInputRef}
            type="file"
            multiple
            accept="image/*"
            className="sr-only"
            onChange={(e) => void handleUploadIngest(e)}
          />
          <Button type="button" variant="outline" onClick={() => uploadInputRef.current?.click()}>
            <Upload size={17} aria-hidden="true" />Tải ảnh lên
          </Button>
        </form>

        {activeJob && (
          <div className="mt-3 rounded-xl border border-border bg-background/50 p-3">
            <div className="mb-1.5 flex items-center justify-between text-xs">
              <span className="font-medium">{activeJob.message ?? activeJob.state}</span>
              <span className="tabular-nums">{Math.round(activeJob.progress * 100)}%</span>
            </div>
            <Progress value={activeJob.progress * 100} label="Tiến trình thư viện" />
          </div>
        )}
      </Card>

      {/* Sub-tabs */}
      <div className="mt-5 flex flex-wrap gap-2" role="tablist">
        <Button variant={subTab === 'search' ? 'default' : 'outline'} onClick={() => setSubTab('search')}>
          <Search size={16} aria-hidden="true" />Tìm kiếm CLIP
        </Button>
        <Button variant={subTab === 'dedup' ? 'default' : 'outline'} onClick={() => setSubTab('dedup')}>
          <CopyCheck size={16} aria-hidden="true" />Lọc trùng &amp; Chọn ảnh đẹp
        </Button>
        <Button variant={subTab === 'mlops' ? 'default' : 'outline'} onClick={() => setSubTab('mlops')}>
          <History size={16} aria-hidden="true" />Sửa nhãn &amp; MLOps
        </Button>
      </div>

      {/* Sub-tab 1: Semantic Search */}
      {subTab === 'search' && (
        <div className="mt-5 space-y-5">
          <Card className="p-4 sm:p-5">
            <form
              onSubmit={(e) => {
                e.preventDefault()
                void runSearch()
              }}
              className="flex flex-col gap-2 sm:flex-row"
            >
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Tìm bằng ngôn ngữ tự nhiên (vd: bắn cung, swimmer in pool, racing car...)"
                className="min-h-11 flex-1 rounded-xl border border-border bg-background/80 px-3 text-sm"
              />
              <Button type="submit" disabled={searching}>
                {searching ? <LoaderCircle size={16} className="motion-safe:animate-spin" /> : <Search size={16} />}
                Tìm kiếm
              </Button>
              <input
                ref={similarInputRef}
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={(e) => void handleSimilarByFile(e)}
              />
              <Button type="button" variant="outline" onClick={() => similarInputRef.current?.click()}>
                <ImagePlus size={16} aria-hidden="true" />Tìm bằng ảnh
              </Button>
            </form>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">Gợi ý:</span>
              {EXAMPLE_QUERIES.map((sample) => (
                <button
                  key={sample}
                  type="button"
                  onClick={() => {
                    setQuery(sample)
                    void runSearch(sample)
                  }}
                  className="rounded-full border border-border bg-muted/40 px-2.5 py-1 text-xs hover:bg-muted"
                >
                  {sample}
                </button>
              ))}
            </div>

            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <select
                value={filterLabel}
                onChange={(e) => setFilterLabel(e.target.value)}
                className="min-h-10 rounded-xl border border-border bg-background/80 px-3 text-xs"
              >
                <option value="">Tất cả môn thể thao</option>
                {Object.keys(stats?.by_label ?? {}).sort().map((lbl) => (
                  <option key={lbl} value={lbl}>
                    {sportNameVi(lbl)} ({lbl})
                  </option>
                ))}
              </select>
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="min-h-10 rounded-xl border border-border bg-background/80 px-3 text-xs"
              >
                <option value="">Tất cả trạng thái độ tin cậy</option>
                <option value="auto">Tự động (auto)</option>
                <option value="review">Cần kiểm tra (review)</option>
                <option value="unknown">Không chắc chắn (unknown)</option>
              </select>
            </div>

            {expandedQuery && (
              <p className="mt-2 text-xs text-muted-foreground">
                Truy vấn CLIP: <span className="font-medium text-foreground">{expandedQuery}</span> · {totalItems} kết quả
              </p>
            )}
          </Card>

          {items.length === 0 ? (
            <Card className="p-6 text-center text-sm text-muted-foreground">
              Chưa có ảnh nào phù hợp. Hãy bấm <strong>Nạp thư mục</strong> (mặc định <code>datasets/anh-ngoai</code>) ở trên để bắt đầu!
            </Card>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {items.map((item) => (
                <Card key={item.image_id} className="overflow-hidden p-2.5">
                  <div className="relative aspect-square overflow-hidden rounded-lg bg-muted/40">
                    <img src={item.thumb_url} alt={item.filename} loading="lazy" className="size-full object-cover" />
                    {item.similarity !== null && (
                      <span className="absolute top-2 right-2 rounded-full bg-slate-950/80 px-2 py-0.5 text-[11px] font-semibold text-emerald-300 tabular-nums">
                        Khớp {pct.format(Math.max(0, item.similarity))}
                      </span>
                    )}
                  </div>
                  <div className="mt-2 space-y-1">
                    <p className="truncate text-xs font-medium" title={item.filename}>{item.filename}</p>
                    <div className="flex items-center justify-between gap-1 text-xs">
                      <SportLabel label={item.label} />
                      <span className="text-muted-foreground tabular-nums">
                        {pct.format(item.calibrated_prob ?? item.top1_prob)}
                      </span>
                    </div>
                    <Button
                      variant="outline"
                      className="mt-1 min-h-8 w-full py-1 text-xs"
                      onClick={() => {
                        setSearching(true)
                        void searchSimilarById(item.image_id)
                          .then((res) => {
                            setItems(res.items)
                            setTotalItems(res.items.length)
                            setExpandedQuery(`Ảnh tương tự #${item.image_id} (${item.filename})`)
                          })
                          .finally(() => setSearching(false))
                      }}
                    >
                      <Sparkles size={13} aria-hidden="true" />Tìm ảnh giống
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Sub-tab 2: Duplicate Detection & Best Shot */}
      {subTab === 'dedup' && (
        <div className="mt-5 space-y-5">
          <Card className="p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold">Phát hiện ảnh trùng &amp; chọn ảnh đẹp nhất</h2>
                <p className="text-xs text-muted-foreground">
                  Kết hợp pHash (trùng/cắt/lật) + CLIP cosine &ge; 0.92 (chụp liên tiếp) và chấm điểm độ nét + ánh sáng + độ tin cậy.
                </p>
              </div>
              <Button disabled={dedupRunning} onClick={() => void handleRunDedup()}>
                {dedupRunning ? <LoaderCircle size={16} className="motion-safe:animate-spin" /> : <CopyCheck size={16} />}
                Quét ảnh trùng
              </Button>
            </div>
            {dedupSummary && (
              <div className="mt-4 grid grid-cols-2 gap-3 border-t border-border pt-4 text-xs sm:grid-cols-4">
                <div>Tổng ảnh: <strong>{dedupSummary.total_images}</strong></div>
                <div>Số nhóm trùng: <strong>{dedupSummary.num_groups}</strong></div>
                <div>Ảnh nên lưu trữ bớt: <strong>{dedupSummary.archived_candidates}</strong></div>
                <div>Tỷ lệ giảm: <strong className="text-emerald-400">{pct.format(dedupSummary.reduction_rate)}</strong></div>
              </div>
            )}
          </Card>

          {dupGroups.length === 0 ? (
            <Card className="p-6 text-center text-sm text-muted-foreground">
              Chưa phát hiện nhóm ảnh trùng nào (hoặc hãy bấm <strong>Quét ảnh trùng</strong> sau khi nạp ảnh).
            </Card>
          ) : (
            dupGroups.map((group) => (
              <Card key={group.group_id} className="p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold">Nhóm trùng #{group.group_id} ({group.members.length} ảnh)</h3>
                  <Button
                    variant="outline"
                    onClick={() =>
                      void decideLibraryDedupGroup(group.group_id, { keep_all: true }).then((updated) =>
                        setDupGroups((prev) => prev.map((g) => (g.group_id === updated.group_id ? updated : g))),
                      )
                    }
                  >
                    Giữ tất cả
                  </Button>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  {group.members.map((m) => (
                    <div
                      key={m.image_id}
                      className={cn(
                        'rounded-xl border p-2.5 text-xs',
                        m.is_best ? 'border-emerald-400/60 bg-emerald-500/10' : 'border-border bg-background/40',
                      )}
                    >
                      <div className="relative aspect-square overflow-hidden rounded-lg bg-muted/40">
                        <img src={m.thumb_url} alt={m.filename} className="size-full object-cover" />
                        {m.is_best && (
                          <span className="absolute top-2 left-2 rounded-full bg-emerald-500 px-2 py-0.5 text-[11px] font-semibold text-slate-950">
                            Ảnh đẹp nhất
                          </span>
                        )}
                      </div>
                      <p className="mt-2 truncate font-medium">{m.filename}</p>
                      <p className="mt-1 text-muted-foreground tabular-nums">
                        Tổng: <strong>{m.score_total.toFixed(2)}</strong> · Nét: {m.score_sharpness.toFixed(2)} · Sáng: {m.score_exposure.toFixed(2)}
                      </p>
                      <Button
                        variant={m.user_decision === 'keep' ? 'default' : 'outline'}
                        className="mt-2 min-h-8 w-full py-1 text-xs"
                        onClick={() =>
                          void decideLibraryDedupGroup(group.group_id, { best_image_id: m.image_id }).then((updated) =>
                            setDupGroups((prev) => prev.map((g) => (g.group_id === updated.group_id ? updated : g))),
                          )
                        }
                      >
                        <CheckCircle2 size={13} aria-hidden="true" />
                        {m.user_decision === 'keep' ? 'Đang chọn giữ' : 'Chọn giữ ảnh này'}
                      </Button>
                    </div>
                  ))}
                </div>
              </Card>
            ))
          )}
        </div>
      )}

      {/* Sub-tab 3: Label Correction & MLOps Retrain */}
      {subTab === 'mlops' && (
        <div className="mt-5 space-y-5">
          <Card className="p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold">Cập nhật mô hình từ nhãn đã sửa</h2>
                <p className="text-xs text-muted-foreground">
                  Sửa/xác nhận nhãn ở hàng đợi bên dưới rồi bấm Huấn luyện lại để cập nhật trực tiếp file mô hình hiện tại (không sinh thêm phiên bản mới).
                </p>
              </div>
              <Button disabled={retraining} onClick={() => void handleRetrain()}>
                {retraining ? <LoaderCircle size={16} className="motion-safe:animate-spin" /> : <Sparkles size={16} />}
                Huấn luyện lại từ nhãn sửa
              </Button>
            </div>

            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="py-2 pr-3">Phiên bản</th>
                    <th className="py-2 pr-3">Nhãn sửa</th>
                    <th className="py-2 pr-3">Eval Acc</th>
                    <th className="py-2 pr-3">Macro-F1</th>
                    <th className="py-2 pr-3">ECE (trước → sau)</th>
                    <th className="py-2 pr-3">Temp (T)</th>
                    <th className="py-2">Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {versions.map((v) => (
                    <tr key={v.version} className="border-b border-border/50">
                      <td className="py-2 pr-3 font-semibold">
                        {v.version} {v.is_active && <span className="ml-1 rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] text-emerald-300">Active</span>}
                      </td>
                      <td className="py-2 pr-3 tabular-nums">{v.n_corrections_used}</td>
                      <td className="py-2 pr-3 tabular-nums">
                        {typeof v.metrics.eval_accuracy === 'number' ? pct.format(v.metrics.eval_accuracy) : 'Baseline'}
                      </td>
                      <td className="py-2 pr-3 tabular-nums">
                        {typeof v.metrics.eval_macro_f1 === 'number' ? pct.format(v.metrics.eval_macro_f1) : '—'}
                      </td>
                      <td className="py-2 pr-3 tabular-nums">
                        {typeof v.metrics.ece_before === 'number' && typeof v.metrics.ece_after === 'number'
                          ? `${v.metrics.ece_before} → ${v.metrics.ece_after}`
                          : '—'}
                      </td>
                      <td className="py-2 pr-3 tabular-nums">{v.temperature}</td>
                      <td className="py-2">
                        {!v.is_active && (
                          <Button
                            variant="outline"
                            className="min-h-8 px-2.5 py-1 text-xs"
                            onClick={() =>
                              void promoteLibraryModelVersion(v.version).then((res) => {
                                setVersions(res.versions)
                                toast.success(`Đã kích hoạt ${res.active_version}`)
                              })
                            }
                          >
                            Kích hoạt
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card className="p-4 sm:p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <Tag size={16} aria-hidden="true" />Hàng đợi kiểm tra &amp; sửa nhãn ({reviewItems.length})
              </h3>
              <label className="flex cursor-pointer items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={includeAllReview}
                  onChange={(e) => setIncludeAllReview(e.target.checked)}
                />
                Hiện tất cả ảnh đã nạp
              </label>
            </div>
            {reviewItems.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Không có ảnh nào đang ở trạng thái <code>review</code>/<code>unknown</code>. Tích chọn &ldquo;Hiện tất cả ảnh đã nạp&rdquo; để sửa nhãn bất kỳ ảnh nào.
              </p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {reviewItems.map((item) => (
                  <div key={item.image_id} className="flex gap-3 rounded-xl border border-border bg-background/40 p-2.5">
                    <img src={item.thumb_url} alt={item.filename} className="size-20 shrink-0 rounded-lg object-cover" />
                    <div className="min-w-0 flex-1 space-y-1.5 text-xs">
                      <p className="truncate font-medium">{item.filename}</p>
                      <p className="text-muted-foreground">
                        AI: <SportLabel label={item.top1_label} /> ({pct.format(item.calibrated_prob ?? item.top1_prob)}) ·{' '}
                        <span className={item.label_source === 'human' ? 'text-emerald-400' : ''}>
                          {item.label_source === 'human' ? 'Đã sửa tay' : item.status}
                        </span>
                      </p>
                      <div className="flex gap-1.5">
                        <select
                          aria-label={`Chọn nhãn cho ${item.filename}`}
                          value={item.label}
                          onChange={(e) => {
                            const nextLabel = e.target.value
                            void setLibraryImageLabel(item.image_id, nextLabel)
                              .then(() => {
                                setReviewItems((prev) =>
                                  prev.map((r) =>
                                    r.image_id === item.image_id ? { ...r, label: nextLabel, label_source: 'human' } : r,
                                  ),
                                )
                                void refreshStats()
                                toast.success(`Đã gán nhãn ${sportNameVi(nextLabel)}`)
                              })
                              .catch((err) => toast.error(err instanceof Error ? err.message : 'Không thể lưu nhãn.'))
                          }}
                          className="min-h-9 min-w-0 flex-1 rounded-lg border border-border bg-white px-2 text-xs text-slate-900"
                        >
                          {availableLabels.map((lbl) => (
                            <option key={lbl} value={lbl} className="bg-white text-slate-900">
                              {sportNameVi(lbl)} ({lbl})
                            </option>
                          ))}
                        </select>
                        <Button
                          variant={item.label_source === 'human' ? 'default' : 'outline'}
                          title="Xác nhận nhãn hiện tại"
                          className="min-h-9 shrink-0 px-2.5 py-1 text-xs"
                          onClick={() => {
                            void setLibraryImageLabel(item.image_id, item.label)
                              .then(() => {
                                setReviewItems((prev) =>
                                  prev.map((r) =>
                                    r.image_id === item.image_id ? { ...r, label_source: 'human' } : r,
                                  ),
                                )
                                void refreshStats()
                                toast.success(`Đã xác nhận nhãn ${sportNameVi(item.label)}`)
                              })
                              .catch((err) => toast.error(err instanceof Error ? err.message : 'Không thể lưu nhãn.'))
                          }}
                        >
                          <CheckCircle2 size={14} aria-hidden="true" />
                        </Button>
                        <Button
                          variant="outline"
                          title="Xóa ảnh lỗi / không phải thể thao khỏi thư viện"
                          aria-label={`Xóa ${item.filename}`}
                          className="min-h-9 shrink-0 px-2.5 py-1 text-xs text-destructive"
                          onClick={() => {
                            void deleteLibraryImage(item.image_id)
                              .then(() => {
                                setReviewItems((prev) => prev.filter((r) => r.image_id !== item.image_id))
                                void refreshStats()
                                toast.success(`Đã xóa ${item.filename} khỏi thư viện`)
                              })
                              .catch((err) => toast.error(err instanceof Error ? err.message : 'Không thể xóa ảnh.'))
                          }}
                        >
                          <Trash2 size={14} aria-hidden="true" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}
    </>
  )
}
