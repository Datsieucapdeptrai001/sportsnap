import { useState } from 'react'
import { CircleCheck, TriangleAlert, Trophy } from 'lucide-react'
import { Card } from './ui/card'
import { Progress } from './ui/progress'
import type { Prediction, ScanResult } from '../lib/api'
import { SportArButton } from './sport-ar-button'
import { ExplainButton } from './explain-button'
import { cn } from '../lib/utils'

const percentage = new Intl.NumberFormat('vi-VN', { style: 'percent', maximumFractionDigits: 1 })

export function PredictionCard({ result, image = null, onOpenAr }: { result: Prediction | ScanResult; image?: Blob | null; onOpenAr?: () => void }) {
  const uncertain = result.is_uncertain
  const [explainOpen, setExplainOpen] = useState(false)

  return (
    <Card aria-label="Kết quả nhận diện" className={cn('surface-enter', uncertain && 'border-warning/40 bg-warning-surface/85 hover:border-warning/50')}>
      <div className={cn('mb-5 flex items-center gap-2 text-sm font-medium text-primary', uncertain && 'text-warning')}>
        {uncertain ? <TriangleAlert size={18} aria-hidden="true" /> : <CircleCheck size={18} aria-hidden="true" />}
        {uncertain ? 'Không chắc chắn' : 'Đã nhận diện'}
      </div>
      <div className="flex items-center gap-4">
        <span className={cn('flex size-14 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary', uncertain && 'bg-warning/10 text-warning')}>
          <Trophy size={28} aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">Môn thể thao được dự đoán</p>
          <h2 className="mt-1 break-words text-2xl font-semibold">{result.label}</h2>
        </div>
      </div>
      <div className="mt-6 mb-2 flex items-center justify-between gap-4 text-sm">
        <span className="text-muted-foreground">Độ tin cậy</span>
        <span className={cn('font-semibold text-primary tabular-nums', uncertain && 'text-warning')}>{percentage.format(result.confidence)}</span>
      </div>
      <Progress value={result.confidence * 100} label="Độ tin cậy" className={uncertain ? 'bg-warning' : undefined} />
      {'agreement' in result && (
        <p className="mt-4 text-sm text-muted-foreground">
          Độ đồng thuận giữa các khung hình: <span className="font-semibold text-foreground tabular-nums">{percentage.format(result.agreement)}</span>
          <span className="ml-1">({result.per_frame.length} khung hình)</span>
        </p>
      )}
      {uncertain && (
        <p className="mt-4 text-sm leading-relaxed text-warning">
          Độ tin cậy thấp hơn ngưỡng {percentage.format(result.threshold)}. Ảnh có thể không thuộc các môn mô hình đã học. Hãy thử ảnh rõ hơn, có người chơi hoặc dụng cụ thể thao.
        </p>
      )}
      <div className="mt-6 border-t border-border pt-5">
        <h3 className="text-sm font-semibold">Các dự đoán hàng đầu</h3>
        <ol className="mt-3 space-y-3">
          {result.top3.map((prediction, index) => (
            <li key={prediction.label} className="flex items-center gap-3 text-sm">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-xs text-muted-foreground tabular-nums" aria-hidden="true">{index + 1}</span>
              <span className="min-w-0 flex-1 break-words">{prediction.label}</span>
              <span className="text-muted-foreground tabular-nums">{percentage.format(prediction.confidence)}</span>
            </li>
          ))}
        </ol>
      </div>
      <div className="mt-6 flex flex-wrap items-start gap-3">
        <SportArButton label={result.label} confidence={result.confidence} isUncertain={uncertain} otherDialogOpen={explainOpen} onOpen={onOpenAr} />
        <ExplainButton image={image} camera={'agreement' in result} onOpenChange={setExplainOpen} />
      </div>
    </Card>
  )
}
