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
import { cn } from '../lib/utils'

const capitalize = (label: string) => label.charAt(0).toUpperCase() + label.slice(1)

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
      toast.error(error instanceof Error ? error.message : 'Không tải được dữ liệu dạy AI.')
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
      setExpandedQuery('Ảnh giống ảnh bạn tải lên')
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
      <Card className="hud-panel rounded-2xl p-3 sm:p-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <h1 className="flex items-center gap-2 font-display text-lg font-bold tracking-wide uppercase">
            <Database size={17} className="text-emerald-300" aria-hidden="true" />Kho dữ liệu cộng đồng
          </h1>
          <dl className="flex flex-wrap gap-1.5 text-xs">
            {[
              { label: 'Ảnh đã nạp', value: stats?.total_images ?? 0 },
              { label: 'Ảnh đã học', value: stats?.index_size ?? 0 },
              { label: 'Nhóm ảnh trùng', value: stats?.total_dup_groups ?? 0 },
              { label: 'Lượt đóng góp', value: stats?.human_labels ?? 0 },
            ].map((stat) => (
              <div key={stat.label} className="flex items-baseline gap-1.5 rounded-full border border-border/70 bg-background/40 px-2.5 py-1">
                <dt className="text-muted-foreground">{stat.label}</dt>
                <dd className="font-semibold tabular-nums">{stat.value}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="mt-3 flex flex-col gap-2 border-t border-border/60 pt-3 lg:flex-row lg:items-center">
          <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Chức năng thư viện">
            {([
              { id: 'search', icon: Search, label: 'Tìm kiếm' },
              { id: 'dedup', icon: CopyCheck, label: 'Lọc trùng & chọn ảnh đẹp' },
              { id: 'mlops', icon: History, label: 'Dạy AI nhận diện' },
            ] as const).map(({ id, icon: Icon, label }) => (
              <Button key={id} role="tab" aria-selected={subTab === id} variant={subTab === id ? 'default' : 'outline'}
                className="min-h-9 px-3 py-1 text-xs" onClick={() => setSubTab(id)}>
                <Icon size={15} aria-hidden="true" />{label}
              </Button>
            ))}
          </div>
          <form onSubmit={(e) => void handleIngestFolder(e)} className="flex min-w-0 flex-1 gap-1.5 lg:justify-end">
            <input
              type="text"
              value={folder}
              onChange={(e) => setFolder(e.target.value)}
              aria-label="Đường dẫn thư mục ảnh"
              placeholder="Thư mục ảnh (vd: datasets/anh-ngoai)"
              className="min-h-9 min-w-0 flex-1 rounded-lg border border-border bg-background/80 px-3 text-xs lg:max-w-64"
            />
            <Button type="submit" className="min-h-9 shrink-0 px-3 py-1 text-xs" disabled={activeJob?.state === 'running'}>
              <FolderUp size={15} aria-hidden="true" />Nạp
            </Button>
            <input
              ref={uploadInputRef}
              type="file"
              multiple
              accept="image/*"
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
              onChange={(e) => void handleUploadIngest(e)}
            />
            <Button type="button" variant="outline" className="min-h-9 shrink-0 px-3 py-1 text-xs" onClick={() => uploadInputRef.current?.click()}>
              <Upload size={15} aria-hidden="true" />Tải ảnh lên
            </Button>
          </form>
        </div>

        {activeJob && (
          <div className="mt-2 rounded-lg border border-border bg-background/50 px-3 py-2">
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="font-medium">{activeJob.message ?? activeJob.state}</span>
              <span className="tabular-nums">{Math.round(activeJob.progress * 100)}%</span>
            </div>
            <Progress value={activeJob.progress * 100} label="Tiến trình thư viện" />
          </div>
        )}
      </Card>

      {/* Sub-tab 1: Semantic Search */}
      {subTab === 'search' && (
        <div className="mt-4 space-y-4">
          <Card className="p-3 sm:p-4">
            <form
              onSubmit={(e) => {
                e.preventDefault()
                void runSearch()
              }}
              className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_auto_auto_auto_auto]"
            >
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Tìm ảnh bằng mô tả"
                placeholder="Mô tả ảnh cần tìm (vd: bắn cung, swimmer in pool…)"
                className="min-h-10 min-w-0 rounded-lg border border-border bg-background/80 px-3 text-sm"
              />
              <select
                value={filterLabel}
                onChange={(e) => setFilterLabel(e.target.value)}
                aria-label="Lọc theo môn thể thao"
                className="min-h-10 rounded-lg border border-border bg-background/80 px-2.5 text-xs"
              >
                <option value="">Mọi môn</option>
                {Object.keys(stats?.by_label ?? {}).sort().map((lbl) => (
                  <option key={lbl} value={lbl}>{capitalize(lbl)}</option>
                ))}
              </select>
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                aria-label="Lọc theo trạng thái"
                className="min-h-10 rounded-lg border border-border bg-background/80 px-2.5 text-xs"
              >
                <option value="">Mọi trạng thái</option>
                <option value="auto">AI chắc chắn</option>
                <option value="review">Cần xác nhận</option>
                <option value="unknown">Chưa rõ môn</option>
              </select>
              <Button type="submit" className="min-h-10" disabled={searching}>
                {searching ? <LoaderCircle size={16} className="motion-safe:animate-spin" aria-hidden="true" /> : <Search size={16} aria-hidden="true" />}
                Tìm
              </Button>
              <input
                ref={similarInputRef}
                type="file"
                accept="image/*"
                className="sr-only"
                tabIndex={-1}
                aria-hidden="true"
                onChange={(e) => void handleSimilarByFile(e)}
              />
              <Button type="button" variant="outline" className="min-h-10" onClick={() => similarInputRef.current?.click()}>
                <ImagePlus size={16} aria-hidden="true" />Tìm bằng ảnh
              </Button>
            </form>

            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-muted-foreground">Gợi ý:</span>
              {EXAMPLE_QUERIES.map((sample) => (
                <button
                  key={sample}
                  type="button"
                  onClick={() => {
                    setQuery(sample)
                    void runSearch(sample)
                  }}
                  className="rounded-full border border-border bg-muted/40 px-2.5 py-0.5 text-xs hover:bg-muted"
                >
                  {sample}
                </button>
              ))}
              {expandedQuery && (
                <span className="ml-auto text-xs text-muted-foreground">
                  {totalItems} ảnh · <span className="text-foreground">{expandedQuery}</span>
                </span>
              )}
            </div>
          </Card>

          {items.length === 0 ? (
            <Card className="p-6 text-center text-sm text-muted-foreground">
              Chưa có ảnh nào phù hợp. Hãy bấm <strong>Nạp thư mục</strong> (mặc định <code>datasets/anh-ngoai</code>) ở trên để bắt đầu!
            </Card>
          ) : (
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
              {items.map((item) => (
                <Card key={item.image_id} className="overflow-hidden rounded-2xl p-0">
                  <div className="relative aspect-[4/3] overflow-hidden bg-muted/40">
                    <img src={item.thumb_url} alt={`Ảnh ${item.label}`} loading="lazy" decoding="async" className="size-full object-cover" />
                    {item.status === 'review' && item.label_source !== 'human' && (
                      <span className="absolute top-2 left-2 rounded-full bg-amber-400/90 px-2 py-0.5 text-[11px] font-semibold text-slate-950">
                        Cần xác nhận
                      </span>
                    )}
                    {item.similarity !== null && (
                      <span className="absolute top-2 right-2 rounded-full bg-slate-950/80 px-2 py-0.5 text-[11px] font-semibold text-emerald-300 tabular-nums">
                        Khớp {pct.format(Math.max(0, item.similarity))}
                      </span>
                    )}
                  </div>
                  <div className="space-y-1.5 p-3">
                    <div className="flex items-baseline justify-between gap-2 text-sm">
                      <span className="min-w-0 truncate font-medium capitalize">{item.label}</span>
                      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                        {pct.format(item.calibrated_prob ?? item.top1_prob)}
                      </span>
                    </div>
                    <Button
                      variant="outline"
                      className="mt-1 min-h-9 w-full py-1 text-xs"
                      onClick={() => {
                        setSearching(true)
                        void searchSimilarById(item.image_id)
                          .then((res) => {
                            setItems(res.items)
                            setTotalItems(res.items.length)
                            setExpandedQuery('Ảnh giống ảnh đã chọn')
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
        <div className="mt-4 space-y-4">
          <Card className="p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold">Phát hiện ảnh trùng &amp; chọn ảnh đẹp nhất</h2>
                <p className="text-xs text-muted-foreground">
                  Gom các ảnh giống nhau (cắt, lật, chụp liên tiếp) và gợi ý ảnh nét, đủ sáng nhất để giữ lại.
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
                        <img src={m.thumb_url} alt="Ảnh trong nhóm trùng"className="size-full object-cover" />
                        {m.is_best && (
                          <span className="absolute top-2 left-2 rounded-full bg-emerald-500 px-2 py-0.5 text-[11px] font-semibold text-slate-950">
                            Ảnh đẹp nhất
                          </span>
                        )}
                      </div>
                      <p className="mt-2 text-muted-foreground tabular-nums">
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

      {/* Sub-tab 3: teach the AI (label correction + retrain) */}
      {subTab === 'mlops' && (
        <div className="mt-4 space-y-4">
          <Card className="p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold">Dạy AI từ các lượt đóng góp</h2>
                <p className="text-xs text-muted-foreground">
                  Xác nhận hoặc sửa tên môn ở danh sách bên dưới, rồi bấm Dạy lại AI để mô hình học thêm từ đóng góp của bạn.
                </p>
              </div>
              <Button disabled={retraining} onClick={() => void handleRetrain()}>
                {retraining ? <LoaderCircle size={16} className="motion-safe:animate-spin" /> : <Sparkles size={16} />}
                Dạy lại AI
              </Button>
            </div>

            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="py-2 pr-3">Phiên bản</th>
                    <th className="py-2 pr-3">Lượt đóng góp</th>
                    <th className="py-2 pr-3">Độ chính xác</th>
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
                <Tag size={16} aria-hidden="true" />Ảnh chờ xác nhận ({reviewItems.length})
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
                Không còn ảnh nào cần xác nhận. Tích &ldquo;Hiện tất cả ảnh đã nạp&rdquo; để sửa tên môn của bất kỳ ảnh nào.
              </p>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {reviewItems.map((item) => (
                  <div key={item.image_id} className="flex gap-3 rounded-2xl border border-border bg-background/40 p-3">
                    <img src={item.thumb_url} alt={`Ảnh AI đoán là ${item.top1_label}`} className="size-24 shrink-0 rounded-xl object-cover" />
                    <div className="min-w-0 flex-1 space-y-2 text-xs">
                      <div className="flex min-w-0 items-center gap-1.5">
                        {item.label_source === 'human' ? (
                          <span className="shrink-0 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-300">Đã sửa tay</span>
                        ) : item.status === 'review' ? (
                          <span className="shrink-0 rounded-full bg-amber-400/15 px-2 py-0.5 text-[11px] font-medium text-amber-300">Cần xác nhận</span>
                        ) : item.status === 'unknown' ? (
                          <span className="shrink-0 rounded-full bg-slate-500/20 px-2 py-0.5 text-[11px] font-medium text-slate-300">Chưa rõ môn</span>
                        ) : (
                          <span className="shrink-0 rounded-full bg-slate-500/20 px-2 py-0.5 text-[11px] font-medium text-slate-300">AI tự gán</span>
                        )}
                      </div>
                      <p className="text-muted-foreground">
                        AI đoán: <span className="text-foreground capitalize">{item.top1_label}</span> · {pct.format(item.calibrated_prob ?? item.top1_prob)}
                      </p>
                      <div className="flex gap-1.5">
                        <select
                          aria-label={`Sửa tên môn cho ảnh AI đoán là ${item.top1_label}`}
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
                                toast.success(`Đã lưu: ${capitalize(nextLabel)}`)
                              })
                              .catch((err) => toast.error(err instanceof Error ? err.message : 'Không thể lưu nhãn.'))
                          }}
                          className="min-h-9 min-w-0 flex-1 cursor-pointer truncate rounded-lg border border-border bg-card px-2 text-xs text-foreground transition-colors hover:border-primary/50"
                        >
                          {availableLabels.map((lbl) => (
                            <option key={lbl} value={lbl} className="bg-card text-foreground">
                              {capitalize(lbl)}
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
                                toast.success(`Đã xác nhận: ${capitalize(item.label)}`)
                              })
                              .catch((err) => toast.error(err instanceof Error ? err.message : 'Không thể lưu nhãn.'))
                          }}
                        >
                          <CheckCircle2 size={14} aria-hidden="true" />
                        </Button>
                        <Button
                          variant="outline"
                          title="Xóa ảnh lỗi / không phải thể thao khỏi thư viện"
                          aria-label="Xóa ảnh này khỏi thư viện"
                          className="min-h-9 shrink-0 px-2.5 py-1 text-xs text-destructive"
                          onClick={() => {
                            void deleteLibraryImage(item.image_id)
                              .then(() => {
                                setReviewItems((prev) => prev.filter((r) => r.image_id !== item.image_id))
                                void refreshStats()
                                toast.success('Đã xóa ảnh khỏi thư viện')
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
