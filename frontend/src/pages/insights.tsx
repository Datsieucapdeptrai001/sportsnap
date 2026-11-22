import { useEffect, useState } from 'react'
import { CheckCircle2, Cpu, Eye, Layers, Palette, RotateCcw, ShieldCheck, Sparkles, TriangleAlert, X } from 'lucide-react'
import { getExtendedInsights, getInsights, type ExtendedInsights, type Insights } from '../lib/api'
import { confusionStrength, metric } from '../lib/insights'
import { sportNameVi } from '../lib/sport-names'
import { SportLabel } from '../components/sport-label'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { Skeleton } from '../components/ui/skeleton'

const splitLabels: Record<string, string> = { train: 'Huấn luyện', valid: 'Validation', test: 'Kiểm thử' }
const pct = (value: number | null | undefined) =>
  value === null || value === undefined ? '—' : `${(value * 100).toLocaleString('vi-VN', { minimumFractionDigits: 1, maximumFractionDigits: 2 })}%`

function ExtendedKaggleSection({ ext }: { ext: ExtendedInsights }) {
  const [zoomImg, setZoomImg] = useState<{ src: string; alt: string } | null>(null)
  const [abSort, setAbSort] = useState<'label' | 'person' | 'bg'>('person')

  const sortedAblation = [...ext.ablation_per_class].sort((a, b) => {
    if (abSort === 'person') return b.gradcam_in_person - a.gradcam_in_person
    if (abSort === 'bg') return b.bg_ok - a.bg_ok
    return sportNameVi(a.label).localeCompare(sportNameVi(b.label), 'vi')
  })

  return (
    <div className="space-y-5">
      {/* 1. Verified Kaggle 6,900-image benchmark table */}
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/15 px-2.5 py-0.5 text-xs font-semibold text-primary">
              <Sparkles size={13} aria-hidden="true" />Kết quả thực nghiệm Kaggle mới nhất (6.900 ảnh sạch · 0 leakage)
            </span>
            <h2 className="mt-2 text-lg font-semibold">So sánh 3 kiến trúc &amp; Hiệu năng suy luận CPU</h2>
            <p className="mt-1 text-xs text-muted-foreground">{ext.dataset}</p>
          </div>
          {ext.ensemble_test_acc !== null && (
            <div className="rounded-xl border border-primary/30 bg-primary/10 px-3.5 py-2 text-right">
              <p className="text-[11px] font-medium text-muted-foreground">Ensemble (MNV2 + ResNet50)</p>
              <p className="text-xl font-bold text-primary tabular-nums">{pct(ext.ensemble_test_acc)}</p>
            </div>
          )}
        </div>

        <div className="mt-5 space-y-3.5">
          {ext.models.map((m) => (
            <div key={m.name}>
              <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2 text-sm">
                <span className="font-medium">
                  {m.name}
                  {m.name === 'MobileNetV2' && (
                    <span className="ml-2 rounded-full bg-primary-soft px-2 py-0.5 text-[11px] font-semibold text-primary">
                      Triển khai Web App
                    </span>
                  )}
                </span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  Test <strong className="text-foreground">{pct(m.test_acc)}</strong>
                  {m.head_test_acc !== null && <> (Frozen {pct(m.head_test_acc)} → +{((m.test_acc - m.head_test_acc) * 100).toFixed(1)}%)</>}
                </span>
              </div>
              <div className="h-2.5 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${m.test_acc * 100}%` }} />
              </div>
            </div>
          ))}
        </div>

        <div className="mt-5 overflow-x-auto rounded-xl border border-border" tabIndex={0} role="region" aria-label="Bảng chỉ số Kaggle đầy đủ">
          <table className="w-full min-w-[680px] text-left text-sm">
            <thead className="bg-muted/40">
              <tr>
                {['Mô hình', 'Val Acc', 'Frozen Test', 'Fine-tune Test', 'Macro-F1', 'Kích thước', 'CPU (ms/ảnh)'].map((h) => (
                  <th key={h} scope="col" className="p-3 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ext.models.map((m) => (
                <tr key={m.name} className="border-t border-border">
                  <th scope="row" className="p-3 font-medium">
                    {m.name}
                    {m.best_epoch && <span className="block text-xs font-normal text-muted-foreground">Best epoch {m.best_epoch}</span>}
                  </th>
                  <td className="p-3 tabular-nums">{pct(m.val_acc)}</td>
                  <td className="p-3 tabular-nums">{pct(m.head_test_acc)}</td>
                  <td className="p-3 font-semibold text-foreground tabular-nums">
                    {pct(m.test_acc)}
                    {m.test_tta_acc !== null && <span className="block text-xs font-normal text-muted-foreground">+TTA: {pct(m.test_tta_acc)}</span>}
                  </td>
                  <td className="p-3 tabular-nums">{m.test_macro_f1 !== null ? m.test_macro_f1.toFixed(2) : '—'}</td>
                  <td className="p-3 tabular-nums">{m.size_mb !== null ? `${m.size_mb.toFixed(2)} MB` : '—'}</td>
                  <td className="p-3 tabular-nums">{m.cpu_ms !== null ? `${m.cpu_ms.toFixed(1)} ms` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* 2. Statistical robustness grid: 5-Fold, Multi-seed, Extended Test 80/20, pHash */}
      <div className="grid gap-5 md:grid-cols-2">
        <Card>
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <ShieldCheck size={18} className="text-primary" aria-hidden="true" />Kiểm chứng thống kê &amp; Chống rò rỉ
          </h2>
          <dl className="mt-4 space-y-3 text-sm">
            {ext.kfold && (
              <div className="rounded-xl border border-border bg-lane/60 p-3">
                <dt className="text-xs text-muted-foreground">Stratified 5-Fold CV (ResNet50 · {ext.kfold.n_total.toLocaleString('vi-VN')} ảnh)</dt>
                <dd className="mt-1 flex items-baseline justify-between gap-2">
                  <span className="text-lg font-bold text-primary tabular-nums">
                    {(ext.kfold.mean * 100).toFixed(2)}% ± {(ext.kfold.std * 100).toFixed(2)}%
                  </span>
                  <span className="text-xs text-muted-foreground tabular-nums">OOF F1: {ext.kfold.oof_macro_f1.toFixed(2)}</span>
                </dd>
                <p className="mt-1 text-xs text-muted-foreground tabular-nums">
                  Các fold: {ext.kfold.folds.map((f) => `${(f * 100).toFixed(2)}%`).join(' · ')}
                </p>
              </div>
            )}
            {ext.extended_test_20pct && (
              <div className="rounded-xl border border-border bg-lane/60 p-3">
                <dt className="text-xs text-muted-foreground">Tập test mở rộng 80/20 (MobileNetV2 · n = {ext.extended_test_20pct.n.toLocaleString('vi-VN')})</dt>
                <dd className="mt-1 flex items-baseline justify-between gap-2">
                  <span className="text-lg font-bold tabular-nums">{pct(ext.extended_test_20pct.acc)}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    Wilson 95% CI: [{pct(ext.extended_test_20pct.wilson_95_ci[0])}; {pct(ext.extended_test_20pct.wilson_95_ci[1])}]
                  </span>
                </dd>
              </div>
            )}
            {ext.phash_check && (
              <div className="flex items-center justify-between gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3">
                <div>
                  <dt className="flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                    <CheckCircle2 size={14} aria-hidden="true" />Kiểm tra trùng lặp pHash (Hamming ≤ 5)
                  </dt>
                  <dd className="mt-0.5 text-xs text-muted-foreground">
                    0 cặp trùng giữa train và valid/test (test sạch n = {ext.phash_check.clean_test_n})
                  </dd>
                </div>
                <span className="text-lg font-bold text-emerald-600 tabular-nums dark:text-emerald-400">
                  {ext.phash_check.near_pairs_le_5}
                </span>
              </div>
            )}
          </dl>
        </Card>

        <Card>
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <Cpu size={18} className="text-primary" aria-hidden="true" />Độ ổn định Multi-seed &amp; Ảnh ngoài (`anh-ngoai`)
          </h2>
          {ext.multi_seed.length > 0 && (
            <div className="mt-3 space-y-2">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Lặp nhiều hạt giống (Multi-seed)</p>
              {ext.multi_seed.map((ms) => (
                <div key={ms.model} className="flex items-center justify-between gap-2 rounded-xl border border-border bg-lane/60 px-3 py-2 text-sm">
                  <span className="font-medium">{ms.model} <span className="text-xs text-muted-foreground">({ms.runs.length} seed)</span></span>
                  <span className="font-semibold tabular-nums">
                    {(ms.acc_mean * 100).toFixed(2)}% ± {(ms.acc_std * 100).toFixed(2)}%
                  </span>
                </div>
              ))}
            </div>
          )}
          {ext.external_eval.length > 0 && (
            <div className="mt-4 space-y-2.5">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Tập ảnh ngoài độc lập (n = {ext.external_eval[0].n})</p>
              {ext.external_eval.map((ev) => (
                <div key={ev.model}>
                  <div className="mb-1 flex justify-between text-xs">
                    <span className="font-medium">{ev.model}</span>
                    <span className="tabular-nums">
                      Top-1 <strong>{pct(ev.top1)}</strong> ({ev.top1_correct}/{ev.n}) · Top-5 <strong>{pct(ev.top5)}</strong>
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${ev.top1 * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* 3. DeepLabV3 Background vs Foreground Ablation */}
      {ext.ablation_deeplabv3 && (
        <Card>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="flex items-center gap-2 text-lg font-semibold">
                <Layers size={19} className="text-primary" aria-hidden="true" />Phân tích DeepLabV3 Ablation (Che nền / Che người)
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Mô hình {ext.ablation_deeplabv3.model} trên toàn bộ {ext.ablation_deeplabv3.n.toLocaleString('vi-VN')} ảnh valid + test — đo mức độ phụ thuộc vào vận động viên so với bối cảnh sân bãi.
              </p>
            </div>
            <div className="flex items-center gap-1 rounded-xl border border-border bg-muted/40 p-1 text-xs">
              {([['person', 'Grad-CAM người ↓'], ['bg', 'Chỉ nền ↓'], ['label', 'Tên A→Z']] as const).map(([key, lbl]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setAbSort(key)}
                  className={`rounded-lg px-2.5 py-1 font-medium transition-colors ${abSort === key ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  {lbl}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { title: 'Ảnh gốc', val: ext.ablation_deeplabv3.acc_orig, tone: 'text-primary' },
              { title: 'Chỉ giữ nền (che người)', val: ext.ablation_deeplabv3.acc_bg_only, tone: 'text-amber-500' },
              { title: 'Chỉ giữ người (che nền)', val: ext.ablation_deeplabv3.acc_person_only, tone: 'text-sky-500' },
              { title: 'Grad-CAM trên người', val: ext.ablation_deeplabv3.gradcam_in_person_mean, tone: 'text-foreground' },
            ].map((item) => (
              <div key={item.title} className="rounded-xl border border-border bg-lane/60 p-3">
                <p className="text-xs text-muted-foreground">{item.title}</p>
                <p className={`mt-1 text-xl font-bold tabular-nums ${item.tone}`}>{pct(item.val)}</p>
              </div>
            ))}
          </div>

          {sortedAblation.length > 0 && (
            <div className="mt-4 max-h-80 overflow-auto rounded-xl border border-border" tabIndex={0} role="region" aria-label="Bảng Ablation theo từng môn">
              <table className="w-full min-w-[540px] text-left text-xs sm:text-sm">
                <thead className="sticky top-0 z-10 bg-card shadow-xs">
                  <tr>
                    <th className="p-2.5 font-medium">Môn thể thao</th>
                    <th className="p-2.5 font-medium">Ảnh gốc</th>
                    <th className="p-2.5 font-medium">Chỉ nền</th>
                    <th className="p-2.5 font-medium">Chỉ người</th>
                    <th className="p-2.5 font-medium">Grad-CAM trên người</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedAblation.map((row) => (
                    <tr key={row.label} className="border-t border-border">
                      <th scope="row" className="p-2.5 font-medium"><SportLabel label={row.label} /></th>
                      <td className="p-2.5 tabular-nums">{pct(row.orig_ok)}</td>
                      <td className="p-2.5 tabular-nums">{pct(row.bg_ok)}</td>
                      <td className="p-2.5 tabular-nums">{pct(row.person_ok)}</td>
                      <td className="p-2.5">
                        <div className="flex items-center gap-2">
                          <div className="h-2 w-20 overflow-hidden rounded-full bg-muted">
                            <div className="h-full rounded-full bg-primary" style={{ width: `${row.gradcam_in_person * 100}%` }} />
                          </div>
                          <span className="tabular-nums">{pct(row.gradcam_in_person)}</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {/* 4. Color Ablation (Court / Environment Color Sensitivity) */}
      {ext.color_ablation && (
        <Card>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="flex items-center gap-2 text-lg font-semibold">
                <Palette size={19} className="text-primary" aria-hidden="true" />
                Thí nghiệm Mất màu (Color Ablation · n = {ext.color_ablation.n_test.toLocaleString('vi-VN')} ảnh test)
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Định lượng vai trò màu sắc / màu sân bằng cách so sánh ảnh màu gốc (RGB), ảnh xám (Grayscale) và hoán đổi kênh màu (R↔B).
              </p>
            </div>
            {ext.color_ablation.chart_image && (
              <Button
                variant="outline"
                onClick={() =>
                  setZoomImg({
                    src: `/api/insights/files/${ext.color_ablation!.chart_image}`,
                    alt: 'Biểu đồ Color Ablation 3 mô hình và 12 lớp nhạy cảm màu sắc nhất',
                  })
                }
              >
                Phóng to biểu đồ
              </Button>
            )}
          </div>
          <div className="mt-4 overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[620px] text-left text-sm">
              <thead className="bg-muted/40">
                <tr>
                  <th className="p-3 font-medium">Mô hình</th>
                  <th className="p-3 font-medium">Ảnh màu gốc (RGB)</th>
                  <th className="p-3 font-medium">Ảnh xám (Grayscale)</th>
                  <th className="p-3 font-medium">Giảm khi mất màu</th>
                  <th className="p-3 font-medium">Hoán đổi kênh (R↔B)</th>
                  <th className="p-3 font-medium">Giảm khi sai màu</th>
                </tr>
              </thead>
              <tbody>
                {ext.color_ablation.models.map((row) => (
                  <tr key={row.name} className="border-t border-border">
                    <th scope="row" className="p-3 font-semibold">{row.name}</th>
                    <td className="p-3 font-medium text-primary tabular-nums">{pct(row.rgb_orig.accuracy)}</td>
                    <td className="p-3 tabular-nums">{pct(row.grayscale.accuracy)}</td>
                    <td className="p-3 font-medium text-amber-600 dark:text-amber-400 tabular-nums">
                      -{row.grayscale_drop_pp.toLocaleString('vi-VN', { minimumFractionDigits: 1, maximumFractionDigits: 2 })} đ.p.t
                    </td>
                    <td className="p-3 tabular-nums">{pct(row.rb_swap.accuracy)}</td>
                    <td className="p-3 font-medium text-amber-600 dark:text-amber-400 tabular-nums">
                      -{row.rb_swap_drop_pp.toLocaleString('vi-VN', { minimumFractionDigits: 1, maximumFractionDigits: 2 })} đ.p.t
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {ext.color_ablation.chart_image && (
            <button
              type="button"
              onClick={() =>
                setZoomImg({
                  src: `/api/insights/files/${ext.color_ablation!.chart_image}`,
                  alt: 'Biểu đồ Color Ablation 3 mô hình và 12 lớp nhạy cảm màu sắc nhất',
                })
              }
              className="mt-4 block w-full overflow-hidden rounded-xl border border-border bg-white transition-opacity hover:opacity-95"
              aria-label="Phóng to biểu đồ Color Ablation"
            >
              <img
                src={`/api/insights/files/${ext.color_ablation.chart_image}`}
                alt="Biểu đồ Color Ablation 3 mô hình và 12 lớp nhạy cảm màu sắc nhất"
                loading="lazy"
                className="w-full object-contain"
              />
            </button>
          )}
        </Card>
      )}

      {/* 5. Side-by-side 3-Model Grad-CAM Gallery */}
      {ext.gradcam_comparison_image && (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="flex items-center gap-2 text-lg font-semibold">
                <Eye size={19} className="text-primary" aria-hidden="true" />Đối chiếu trực tiếp Grad-CAM giữa 3 kiến trúc
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                So sánh vùng tập trung của CNN_Scratch, MobileNetV2 và ResNet50 trên cùng 6 ảnh kiểm thử (bao gồm lớp mới <code>soccer</code>). Bấm vào ảnh để phóng to.
              </p>
            </div>
            <Button
              variant="outline"
              onClick={() =>
                setZoomImg({
                  src: `/api/insights/files/${ext.gradcam_comparison_image}`,
                  alt: 'Đối chiếu Grad-CAM phóng to',
                })
              }
            >
              Phóng to ảnh
            </Button>
          </div>
          <button
            type="button"
            onClick={() =>
              setZoomImg({
                src: `/api/insights/files/${ext.gradcam_comparison_image}`,
                alt: 'Đối chiếu Grad-CAM phóng to',
              })
            }
            className="mt-4 block w-full overflow-hidden rounded-xl border border-border bg-black/5 transition-opacity hover:opacity-95"
            aria-label="Phóng to ảnh đối chiếu Grad-CAM 3 mô hình"
          >
            <img
              src={`/api/insights/files/${ext.gradcam_comparison_image}`}
              alt="Đối chiếu Grad-CAM của CNN_Scratch, MobileNetV2 và ResNet50 trên 6 ảnh kiểm thử"
              loading="lazy"
              className="w-full object-contain"
            />
          </button>
        </Card>
      )}

      {zoomImg && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={zoomImg.alt}
          onClick={() => setZoomImg(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm"
        >
          <div className="relative max-h-[94svh] max-w-5xl overflow-auto rounded-2xl bg-card p-2 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <Button
              variant="outline"
              onClick={() => setZoomImg(null)}
              aria-label="Đóng ảnh phóng to"
              className="sticky top-2 float-right z-10 size-10 p-0"
            >
              <X size={18} aria-hidden="true" />
            </Button>
            <img
              src={zoomImg.src}
              alt={zoomImg.alt}
              className="w-full rounded-xl bg-white"
            />
          </div>
        </div>
      )}
    </div>
  )
}

function InsightsContent({ data, extended }: { data: Insights; extended: ExtendedInsights | null }) {
  const [selectedSplit, setSelectedSplit] = useState('test')
  const split = data.splits.find((item) => item.split === selectedSplit) ?? data.splits[0]
  return (
    <div className="mt-6 space-y-5">
      {extended && <ExtendedKaggleSection ext={extended} />}

      <Card>
        <h2 className="text-lg font-semibold">So sánh mô hình (tổng hợp chuẩn từ summary.csv)</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">Accuracy từ {data.sources.comparison}. Mô hình được chọn theo validation: <strong className="text-foreground">{data.selected_model}</strong>.</p>
        {data.models.length ? (
          <>
            <div className="mt-5 space-y-4">{data.models.map((model) => (
              <div key={model.name}>
                <div className="mb-2 flex justify-between gap-3 text-sm"><span>{model.name}</span><span className="tabular-nums">{metric(model.accuracy, true)}</span></div>
                <div className="h-2 overflow-hidden rounded-full bg-muted" aria-label={`Accuracy ${model.name}: ${metric(model.accuracy, true)}`}><div className="h-full rounded-full bg-primary" style={{ width: `${(model.accuracy ?? 0) * 100}%` }} /></div>
              </div>
            ))}</div>
            <div className="mt-6 overflow-x-auto rounded-xl border border-border" tabIndex={0} role="region" aria-label="Bảng so sánh mô hình có thể cuộn ngang">
              <table className="w-full min-w-[650px] text-left text-sm"><caption className="sr-only">Kết quả mô hình; dấu — nghĩa là nguồn CSV không có số liệu</caption>
                <thead className="bg-muted/40"><tr>{['Mô hình / chiến lược', 'Accuracy kiểm thử', 'Accuracy validation', 'Macro-F1 kiểm thử', 'Tham số (triệu)', 'Dung lượng (MB)', 'Suy luận (ms)'].map((label) => <th key={label} scope="col" className="p-3 font-medium">{label}</th>)}</tr></thead>
                <tbody>{data.models.map((model) => <tr key={model.name} className="border-t border-border">
                  <th scope="row" className="p-3 font-medium">{model.name}<span className="mt-1 block text-xs font-normal text-muted-foreground">{model.strategy}</span></th>
                  {[metric(model.accuracy, true), metric(model.val_accuracy, true), metric(model.macro_f1), metric(model.params_m), metric(model.size_mb), metric(model.latency_ms)].map((value, index) => <td key={index} className="p-3 tabular-nums">{value}</td>)}
                </tr>)}</tbody>
              </table>
            </div>
          </>
        ) : <p className="mt-4 text-sm text-muted-foreground">Chưa có kết quả so sánh mô hình.</p>}
      </Card>

      <Card>
        <h2 className="text-lg font-semibold">Ma trận nhầm lẫn · {data.selected_model}</h2>
        {split ? (
          <>
            <div className="mt-4 flex flex-wrap items-center gap-3"><label htmlFor="insights-split" className="text-sm">Tập dữ liệu</label><select id="insights-split" value={split.split} onChange={(event) => setSelectedSplit(event.target.value)} className="min-h-11 rounded-xl border border-border bg-card px-3 text-sm">{data.splits.map((item) => <option key={item.split} value={item.split}>{splitLabels[item.split] ?? item.split}</option>)}</select></div>
            <p className="mt-4 text-sm leading-relaxed text-muted-foreground"><span className="tabular-nums">{split.count.toLocaleString('vi-VN')}</span> ảnh · Accuracy <strong className="text-foreground tabular-nums">{metric(split.accuracy, true)}</strong> · Macro-F1 <strong className="text-foreground tabular-nums">{metric(split.macro_f1)}</strong></p>
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">Hàng: nhãn thực tế. Cột: nhãn dự đoán. Màu càng đậm, số ảnh càng nhiều. Cuộn ngang để xem đủ nhãn.</p>
            <div className="mt-4 max-h-[32rem] overflow-auto rounded-xl border border-border" tabIndex={0} role="region" aria-label="Ma trận nhầm lẫn có thể cuộn">
              <table className="border-separate border-spacing-px text-center text-xs"><caption className="sr-only">Ma trận nhầm lẫn {splitLabels[split.split]}, mô hình {data.selected_model}</caption>
                <thead><tr><th className="sticky top-0 left-0 z-20 bg-card p-2">Thực tế ↓ / Dự đoán →</th>{split.labels.map((label) => <th key={label} scope="col" className="sticky top-0 z-10 min-w-14 bg-card p-2 font-medium"><span className="[writing-mode:vertical-rl]">{label}</span></th>)}</tr></thead>
                <tbody>{split.confusion_matrix.map((row, i) => <tr key={split.labels[i]}><th scope="row" className="sticky left-0 z-10 bg-card p-2 text-left font-medium whitespace-nowrap">{split.labels[i]}</th>{row.map((count, j) => <td key={j} title={`${sportNameVi(split.labels[i])} (${split.labels[i]}) → ${sportNameVi(split.labels[j])} (${split.labels[j]}): ${count} ảnh`} style={{ backgroundColor: `rgb(16 185 129 / ${0.06 + confusionStrength(split, count) * 0.65})` }} className="h-10 min-w-14 px-2 tabular-nums">{count}</td>)}</tr>)}</tbody>
              </table>
            </div>
            <h3 className="mt-6 text-sm font-semibold">Các cặp nhầm nhiều nhất</h3>
            {split.top_confusions.length ? <ul className="mt-3 divide-y divide-border">{split.top_confusions.map((pair) => <li key={`${pair.true}-${pair.pred}`} className="flex justify-between gap-4 py-3 text-sm"><span><SportLabel label={pair.true} /> <span className="text-muted-foreground">→</span> <SportLabel label={pair.pred} /></span><span className="shrink-0 text-muted-foreground tabular-nums">{pair.count} ảnh</span></li>)}</ul> : <p className="mt-3 text-sm text-muted-foreground">Không có cặp nhầm trong tập này.</p>}
          </>
        ) : <p className="mt-4 text-sm text-muted-foreground">Chưa có dữ liệu ma trận nhầm lẫn.</p>}
      </Card>

      <Card><h2 className="text-lg font-semibold">Nguồn dữ liệu và phạm vi đo</h2><p className="mt-3 text-sm text-muted-foreground">Nguồn dự đoán: {data.sources.predictions}. {data.sources.attribution}</p><ul className="mt-3 list-disc space-y-3 pl-5 text-sm leading-relaxed text-muted-foreground">{data.notes.map((note) => <li key={note}>{note}</li>)}</ul></Card>
      <Card className="border-warning-line bg-warning-surface"><h2 className="flex items-center gap-2 text-lg font-semibold"><TriangleAlert size={21} className="text-warning" aria-hidden="true" />Hạn chế đã biết</h2><p className="mt-3 max-w-prose text-sm leading-relaxed">Camera nhận diện kém trên các frame bóng chày chụp lại màn hình đã thử. Sai lệch miền ảnh là nguyên nhân nghi ngờ, chưa được tách biệt và chứng minh. Hãy thử ảnh gốc hoặc cảnh thể thao thực, đủ sáng, chủ thể lấp đầy khung hướng dẫn.</p><p className="mt-3 text-xs text-muted-foreground">Nguồn: SPEC.md §13 · Camera scans of screens.</p></Card>
    </div>
  )
}

export function InsightsPage() {
  const [state, setState] = useState<{ data: Insights | null; extended: ExtendedInsights | null; error: string }>({
    data: null,
    extended: null,
    error: '',
  })
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    Promise.all([getInsights(controller.signal), getExtendedInsights(controller.signal)])
      .then(([data, extended]) => {
        if (!controller.signal.aborted) setState({ data, extended, error: '' })
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setState({ data: null, extended: null, error: error instanceof Error ? error.message : 'Không thể tải dữ liệu thí nghiệm.' })
        }
      })
    return () => controller.abort()
  }, [attempt])
  return (
    <>
      <header>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Phân tích mô hình</h1>
        <p className="mt-2 max-w-prose text-sm leading-relaxed text-muted-foreground sm:text-base">
          Đối chiếu kết quả thực nghiệm từ Kaggle (3 kiến trúc, 5-Fold CV, Multi-seed, ảnh ngoài, DeepLabV3 Ablation &amp; Grad-CAM) và ma trận nhầm lẫn.
        </p>
      </header>
      {state.error ? (
        <Card className="mt-6 border-destructive/50 bg-destructive-surface">
          <p role="alert" className="text-sm">{state.error}</p>
          <Button className="mt-4" variant="outline" onClick={() => { setState({ data: null, extended: null, error: '' }); setAttempt((n) => n + 1) }}>
            <RotateCcw size={18} aria-hidden="true" />Thử lại
          </Button>
        </Card>
      ) : state.data ? (
        <InsightsContent data={state.data} extended={state.extended} />
      ) : (
        <Card className="mt-6" aria-busy="true">
          <p role="status" className="mb-4 text-sm">Đang tải dữ liệu thí nghiệm…</p>
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="mt-5 h-40 w-full" />
        </Card>
      )}
    </>
  )
}
