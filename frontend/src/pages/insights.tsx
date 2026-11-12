import { useEffect, useState } from 'react'
import { RotateCcw, TriangleAlert } from 'lucide-react'
import { getInsights, type Insights } from '../lib/api'
import { confusionStrength, metric } from '../lib/insights'
import { SportLabel } from '../components/sport-label'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { Skeleton } from '../components/ui/skeleton'

const splitLabels: Record<string, string> = { train: 'Huấn luyện', valid: 'Validation', test: 'Kiểm thử' }

function InsightsContent({ data }: { data: Insights }) {
  const [selectedSplit, setSelectedSplit] = useState('test')
  const split = data.splits.find((item) => item.split === selectedSplit) ?? data.splits[0]
  return <div className="mt-6 space-y-5">
    <Card>
      <h2 className="text-lg font-semibold">So sánh mô hình</h2>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">Accuracy từ {data.sources.comparison}. Mô hình được chọn theo validation: <strong className="text-foreground">{data.selected_model}</strong>.</p>
      {data.models.length ? <>
        <div className="mt-5 space-y-4">{data.models.map((model) => <div key={model.name}>
          <div className="mb-2 flex justify-between gap-3 text-sm"><span>{model.name}</span><span className="tabular-nums">{metric(model.accuracy, true)}</span></div>
          <div className="h-2 overflow-hidden rounded-full bg-muted" aria-label={`Accuracy ${model.name}: ${metric(model.accuracy, true)}`}><div className="h-full rounded-full bg-primary" style={{ width: `${(model.accuracy ?? 0) * 100}%` }} /></div>
        </div>)}</div>
        <div className="mt-6 overflow-x-auto rounded-xl border border-border" tabIndex={0} role="region" aria-label="Bảng so sánh mô hình có thể cuộn ngang">
          <table className="w-full min-w-[650px] text-left text-sm"><caption className="sr-only">Kết quả mô hình; Chưa đo nghĩa là nguồn CSV không có số liệu</caption>
            <thead className="bg-muted/40"><tr>{['Mô hình / chiến lược', 'Accuracy kiểm thử', 'Accuracy validation', 'Macro-F1 kiểm thử', 'Tham số (triệu)', 'Dung lượng (MB)', 'Suy luận (ms)'].map((label) => <th key={label} scope="col" className="p-3 font-medium">{label}</th>)}</tr></thead>
            <tbody>{data.models.map((model) => <tr key={model.name} className="border-t border-border">
              <th scope="row" className="p-3 font-medium">{model.name}<span className="mt-1 block text-xs font-normal text-muted-foreground">{model.strategy}</span></th>
              {[metric(model.accuracy, true), metric(model.val_accuracy, true), metric(model.macro_f1), metric(model.params_m), metric(model.size_mb), metric(model.latency_ms)].map((value, index) => <td key={index} className="p-3 tabular-nums">{value}</td>)}
            </tr>)}</tbody>
          </table>
        </div>
      </> : <p className="mt-4 text-sm text-muted-foreground">Chưa có kết quả so sánh mô hình.</p>}
    </Card>
    <Card>
      <h2 className="text-lg font-semibold">Ma trận nhầm lẫn · {data.selected_model}</h2>
      {split ? <>
        <div className="mt-4 flex flex-wrap items-center gap-3"><label htmlFor="insights-split" className="text-sm">Tập dữ liệu</label><select id="insights-split" value={split.split} onChange={(event) => setSelectedSplit(event.target.value)} className="min-h-11 rounded-xl border border-border bg-card px-3 text-sm">{data.splits.map((item) => <option key={item.split} value={item.split}>{splitLabels[item.split] ?? item.split}</option>)}</select></div>
        <p className="mt-4 text-sm leading-relaxed text-muted-foreground"><span className="tabular-nums">{split.count.toLocaleString('vi-VN')}</span> ảnh · Accuracy <strong className="text-foreground tabular-nums">{metric(split.accuracy, true)}</strong> · Macro-F1 <strong className="text-foreground tabular-nums">{metric(split.macro_f1)}</strong></p>
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">Hàng: nhãn thực tế. Cột: nhãn dự đoán. Màu càng đậm, số ảnh càng nhiều. Cuộn ngang để xem đủ nhãn.</p>
        <div className="mt-4 max-h-[32rem] overflow-auto rounded-xl border border-border" tabIndex={0} role="region" aria-label="Ma trận nhầm lẫn có thể cuộn">
          <table className="border-separate border-spacing-px text-center text-xs"><caption className="sr-only">Ma trận nhầm lẫn {splitLabels[split.split]}, mô hình {data.selected_model}</caption>
            <thead><tr><th className="sticky left-0 top-0 z-20 bg-card p-2">Thực tế ↓ / Dự đoán →</th>{split.labels.map((label) => <th key={label} scope="col" className="sticky top-0 z-10 min-w-14 bg-card p-2 font-medium"><span className="[writing-mode:vertical-rl]">{label}</span></th>)}</tr></thead>
            <tbody>{split.confusion_matrix.map((row, i) => <tr key={split.labels[i]}><th scope="row" className="sticky left-0 z-10 whitespace-nowrap bg-card p-2 text-left font-medium">{split.labels[i]}</th>{row.map((count, j) => <td key={j} title={`${split.labels[i]} → ${split.labels[j]}: ${count} ảnh`} style={{ backgroundColor: `rgb(16 185 129 / ${0.06 + confusionStrength(split, count) * 0.65})` }} className="h-10 min-w-14 px-2 tabular-nums">{count}</td>)}</tr>)}</tbody>
          </table>
        </div>
        <h3 className="mt-6 text-sm font-semibold">Các cặp nhầm nhiều nhất</h3>
        {split.top_confusions.length ? <ul className="mt-3 divide-y divide-border">{split.top_confusions.map((pair) => <li key={`${pair.true}-${pair.pred}`} className="flex justify-between gap-4 py-3 text-sm"><span><SportLabel label={pair.true} /> <span className="text-muted-foreground">→</span> <SportLabel label={pair.pred} /></span><span className="shrink-0 text-muted-foreground tabular-nums">{pair.count} ảnh</span></li>)}</ul> : <p className="mt-3 text-sm text-muted-foreground">Không có cặp nhầm trong tập này.</p>}
      </> : <p className="mt-4 text-sm text-muted-foreground">Chưa có dữ liệu ma trận nhầm lẫn.</p>}
    </Card>
    <Card><h2 className="text-lg font-semibold">Nguồn dữ liệu và phạm vi đo</h2><p className="mt-3 text-sm text-muted-foreground">Nguồn dự đoán: {data.sources.predictions}. {data.sources.attribution}</p><ul className="mt-3 list-disc space-y-3 pl-5 text-sm leading-relaxed text-muted-foreground">{data.notes.map((note) => <li key={note}>{note}</li>)}</ul></Card>
    <Card className="border-warning-line bg-warning-surface"><h2 className="flex items-center gap-2 text-lg font-semibold"><TriangleAlert size={21} className="text-warning" aria-hidden="true" />Hạn chế đã biết</h2><p className="mt-3 max-w-prose text-sm leading-relaxed">Camera nhận diện kém trên các frame bóng chày chụp lại màn hình đã thử. Sai lệch miền ảnh là nguyên nhân nghi ngờ, chưa được tách biệt và chứng minh. Hãy thử ảnh gốc hoặc cảnh thể thao thực, đủ sáng, chủ thể lấp đầy khung hướng dẫn.</p><p className="mt-3 text-xs text-muted-foreground">Nguồn: SPEC.md §13 · Camera scans of screens.</p></Card>
  </div>
}

export function InsightsPage() {
  const [state, setState] = useState<{ data: Insights | null; error: string }>({ data: null, error: '' })
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    getInsights(controller.signal).then((data) => {
      if (!controller.signal.aborted) setState({ data, error: '' })
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setState({ data: null, error: error instanceof Error ? error.message : 'Không thể tải dữ liệu thí nghiệm.' })
    })
    return () => controller.abort()
  }, [attempt])
  return <>
    <header><h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Phân tích mô hình</h1><p className="mt-2 max-w-prose text-sm leading-relaxed text-muted-foreground sm:text-base">Đối chiếu kết quả từ notebook huấn luyện và xem những nhãn mô hình còn nhầm.</p></header>
    {state.error ? <Card className="mt-6 border-destructive/50 bg-destructive-surface"><p role="alert" className="text-sm">{state.error}</p><Button className="mt-4" variant="outline" onClick={() => { setState({ data: null, error: '' }); setAttempt((n) => n + 1) }}><RotateCcw size={18} aria-hidden="true" />Thử lại</Button></Card>
      : state.data ? <InsightsContent data={state.data} /> : <Card className="mt-6" aria-busy="true"><p role="status" className="mb-4 text-sm">Đang tải dữ liệu thí nghiệm…</p><Skeleton className="h-8 w-2/3" /><Skeleton className="mt-5 h-40 w-full" /></Card>}
  </>
}
