import { useState } from 'react'
import { CircleCheck, Lightbulb, TriangleAlert } from 'lucide-react'
import { Progress } from './ui/progress'
import type { Prediction, ScanResult } from '../lib/api'
import { SportArButton } from './sport-ar-button'
import { ExplainButton } from './explain-button'
import { ConfidenceLanes } from './confidence-lanes'
import { cn } from '../lib/utils'

const percentage = new Intl.NumberFormat('vi-VN', { style: 'percent', maximumFractionDigits: 1 })

export function PredictionCard({ result, image = null, onOpenAr }: { result: Prediction | ScanResult; image?: Blob | null; onOpenAr?: () => void }) {
  const uncertain = result.is_uncertain
  const [explainOpen, setExplainOpen] = useState(false)
  const name = result.label
  const camera = 'agreement' in result

  return (
    <section aria-label="Kết quả nhận diện"
      className={cn('surface-enter rounded-xl border bg-card', uncertain ? 'border-warning-line bg-warning-surface' : 'border-border')}>
      <div className="p-5 sm:p-6">
        <p className={cn('flex items-center gap-2 text-sm font-medium', uncertain ? 'text-warning' : 'text-primary')}>
          {uncertain ? <TriangleAlert size={18} aria-hidden="true" /> : <CircleCheck size={18} aria-hidden="true" />}
          {uncertain ? 'Không chắc chắn' : 'Đã nhận diện'}
        </p>
        {uncertain && <p className="mt-4 text-sm text-warning">Có thể là</p>}
        <h2 className={cn('text-[2.5rem] leading-[1.05] font-bold capitalize tracking-[-0.02em] break-words sm:text-5xl', uncertain ? 'mt-1 text-foreground/80' : 'mt-4')}>{name}</h2>

        <div className="mt-6">
          <div className="mb-2 flex items-baseline justify-between gap-4">
            <span className="text-sm text-muted-foreground">Độ tin cậy</span>
            <span className={cn('text-2xl font-semibold tabular-nums', uncertain ? 'text-warning' : 'text-primary')}>{percentage.format(result.confidence)}</span>
          </div>
          <Progress value={result.confidence * 100} label="Độ tin cậy" marker={result.threshold * 100} className={uncertain ? 'bg-warning-bar' : undefined} />
          <p className="mt-2 text-xs text-muted-foreground">Vạch dọc là ngưỡng chắc chắn {percentage.format(result.threshold)}.</p>
        </div>

        {camera && (
          <p className="mt-4 text-sm text-muted-foreground">
            Khớp giữa các khung hình: <span className="font-semibold text-foreground tabular-nums">{percentage.format(result.agreement)}</span> trong <span className="tabular-nums">{result.per_frame.length}</span> khung
          </p>
        )}

        {uncertain && (
          <div className="mt-5 flex gap-3 rounded-xl border border-warning-line bg-card/70 p-4 text-sm leading-relaxed">
            <Lightbulb size={18} className="mt-0.5 shrink-0 text-warning" aria-hidden="true" />
            <p>
              Độ tin cậy thấp hơn ngưỡng {percentage.format(result.threshold)}, nên chưa thể kết luận. Ảnh có thể không thuộc các môn mô hình đã học.
              Hãy thử ảnh rõ hơn, thấy người chơi hoặc dụng cụ thể thao.
            </p>
          </div>
        )}
      </div>

      <div className={cn('border-t px-5 pt-5 pb-5 sm:px-6 sm:pb-6', uncertain ? 'border-warning-line' : 'border-border')}>
        <h3 className="mb-3 text-sm font-semibold">Ba dự đoán hàng đầu</h3>
        <ConfidenceLanes predictions={result.top3} uncertain={uncertain} />
        <div className="mt-5 grid gap-3 sm:grid-cols-2 sm:items-start">
          <ExplainButton image={image} camera={camera} onOpenChange={setExplainOpen} />
          <SportArButton label={result.label} confidence={result.confidence} isUncertain={uncertain} otherDialogOpen={explainOpen} onOpen={onOpenAr} />
        </div>
      </div>
    </section>
  )
}
