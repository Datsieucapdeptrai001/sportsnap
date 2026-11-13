import { useEffect, useState } from 'react'
import { Check, CircleCheck, Edit3, Lightbulb, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'
import { Progress } from './ui/progress'
import type { Prediction, ScanResult } from '../lib/api'
import { submitCorrection, undoCorrection } from '../lib/api'
import { SportArButton } from './sport-ar-button'
import { ExplainButton } from './explain-button'
import { ConfidenceLanes } from './confidence-lanes'
import { CorrectSportDialog } from './correct-sport-dialog'
import { sportNameVi } from '../lib/sport-names'
import { cn } from '../lib/utils'

const percentage = new Intl.NumberFormat('vi-VN', { style: 'percent', maximumFractionDigits: 1 })

async function computeSha1(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer()
  const hashBuffer = await crypto.subtle.digest('SHA-1', buffer)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

export function PredictionCard({
  result,
  image = null,
  onOpenAr,
  onLabelChange,
}: {
  result: Prediction | ScanResult
  image?: Blob | null
  onOpenAr?: () => void
  onLabelChange?: (newLabel: string) => void
}) {
  const [currentLabel, setCurrentLabel] = useState<string>(result.label)
  const [explainOpen, setExplainOpen] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [isCorrected, setIsCorrected] = useState(false)
  const camera = 'agreement' in result

  useEffect(() => {
    setCurrentLabel(result.label)
    setIsCorrected(false)
  }, [result])

  const conf = result.confidence
  const tier = conf >= 0.75 ? 'certain' : conf >= 0.4 ? 'likely' : 'uncertain'
  const uncertain = result.is_uncertain

  const tierConfig = {
    certain: {
      text: 'Chắc chắn',
      badgeClass: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30',
      icon: CircleCheck,
    },
    likely: {
      text: 'Có thể là…',
      badgeClass: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30',
      icon: Lightbulb,
    },
    uncertain: {
      text: 'Chưa chắc',
      badgeClass: 'bg-slate-500/15 text-slate-600 dark:text-slate-400 border-slate-500/30',
      icon: TriangleAlert,
    },
  }[tier]

  const TierIcon = tierConfig.icon

  const alternatives = (result.top3 || [])
    .filter((item) => item.label !== currentLabel)
    .slice(0, 2)

  const handleCorrect = async (newLabel: string) => {
    if (newLabel === currentLabel) return
    const prev = currentLabel
    setCurrentLabel(newLabel)
    setIsCorrected(true)
    onLabelChange?.(newLabel)

    let sha1 = 'scan-' + Date.now()
    let b64: string | undefined
    if (image) {
      try {
        sha1 = await computeSha1(image)
        b64 = await blobToBase64(image)
      } catch {
        // Fallback sha1
      }
    }

    try {
      const record = await submitCorrection({
        image_sha1: sha1,
        image_base64: b64,
        previous_label: prev,
        predicted_label: result.label,
        corrected_label: newLabel,
        confidence: result.confidence,
      })

      toast.success(`Đã sửa môn thành ${sportNameVi(newLabel)}`, {
        action: {
          label: 'Hoàn tác',
          onClick: async () => {
            try {
              await undoCorrection({ correction_id: record.id })
              setCurrentLabel(prev)
              setIsCorrected(prev !== result.label)
              onLabelChange?.(prev)
              toast.info(`Đã hoàn tác về ${sportNameVi(prev)}.`)
            } catch {
              toast.error('Không thể hoàn tác.')
            }
          },
        },
      })
    } catch {
      toast.error('Không thể lưu nhãn sửa lúc này.')
    }
  }

  const handleConfirmCorrect = () => {
    toast.success(`Cảm ơn bạn đã xác nhận môn ${sportNameVi(currentLabel)}!`, {
      icon: <CircleCheck className="text-emerald-500" size={16} />,
    })
  }

  return (
    <section
      aria-label="Kết quả nhận diện"
      className={cn(
        'surface-enter rounded-2xl border bg-card/90 backdrop-blur-md shadow-sm',
        tier === 'uncertain' ? 'border-warning-line/60 bg-warning-surface/40' : 'border-border',
      )}
    >
      <div className="p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold',
              tierConfig.badgeClass,
            )}
          >
            <TierIcon size={14} aria-hidden="true" />
            {tierConfig.text} · {percentage.format(conf)}
          </span>
          {isCorrected && (
            <span className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
              <Check size={12} /> Đã sửa nhãn
            </span>
          )}
        </div>

        <div className="mt-4">
          <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight break-words capitalize">
            {sportNameVi(currentLabel)}
          </h2>
          <p className="mt-0.5 text-xs font-medium uppercase tracking-widest text-muted-foreground">
            {currentLabel}
          </p>
        </div>

        {/* 2 Alternative chips for 1-click correction */}
        {alternatives.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">Gợi ý khác:</span>
            {alternatives.map((alt) => (
              <button
                key={alt.label}
                type="button"
                onClick={() => void handleCorrect(alt.label)}
                title={`Bấm để chọn ${sportNameVi(alt.label)}`}
                className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-border/80 bg-muted/40 px-3 py-1 text-xs font-medium text-foreground hover:border-primary hover:bg-primary/10 transition-colors"
              >
                <span>{sportNameVi(alt.label)}</span>
                <span className="text-[11px] text-muted-foreground tabular-nums">
                  {percentage.format(alt.confidence)}
                </span>
              </button>
            ))}
          </div>
        )}

        {/* Action Buttons: Đúng rồi & Sửa lại môn này */}
        <div className="mt-5 flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={handleConfirmCorrect}
            className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-2 text-xs font-medium text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20 transition-colors"
          >
            <Check size={14} /> Đúng rồi
          </button>
          <button
            type="button"
            onClick={() => setDialogOpen(true)}
            className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-xl border border-border bg-card px-3.5 py-2 text-xs font-medium text-foreground hover:bg-muted hover:border-primary/50 transition-colors"
          >
            <Edit3 size={14} /> Sửa lại môn này
          </button>
        </div>

        <div className="mt-6 border-t border-border/60 pt-5">
          <div className="mb-2 flex items-baseline justify-between gap-4">
            <span className="text-xs font-medium text-muted-foreground">Mức độ tin cậy</span>
            <span
              className={cn(
                'text-xl font-bold tabular-nums',
                tier === 'certain' ? 'text-primary' : tier === 'likely' ? 'text-amber-500' : 'text-muted-foreground',
              )}
            >
              {percentage.format(result.confidence)}
            </span>
          </div>
          <Progress
            value={result.confidence * 100}
            label="Độ tin cậy"
            marker={result.threshold * 100}
            className={tier === 'uncertain' ? 'bg-warning-bar' : undefined}
          />
          <p className="mt-2 text-xs text-muted-foreground">
            Vạch chuẩn xác nhận: {percentage.format(result.threshold)}.
          </p>
        </div>

        {camera && (
          <p className="mt-4 text-xs text-muted-foreground">
            Khớp giữa các khung hình:{' '}
            <span className="font-semibold text-foreground tabular-nums">
              {percentage.format(result.agreement)}
            </span>{' '}
            trong <span className="tabular-nums">{result.per_frame.length}</span> khung
          </p>
        )}

        {tier === 'uncertain' && (
          <div className="mt-5 flex gap-3 rounded-xl border border-warning-line/60 bg-card/70 p-3.5 text-xs leading-relaxed">
            <Lightbulb size={16} className="mt-0.5 shrink-0 text-warning" aria-hidden="true" />
            <p>
              Độ tin cậy thấp hơn ngưỡng {percentage.format(result.threshold)}. Hãy chọn một trong các gợi ý ở trên hoặc bấm &ldquo;Sửa lại môn này&rdquo; để gắn nhãn chuẩn xác.
            </p>
          </div>
        )}
      </div>

      <div
        className={cn(
          'border-t px-5 pt-5 pb-5 sm:px-6 sm:pb-6',
          tier === 'uncertain' ? 'border-warning-line/40' : 'border-border/60',
        )}
      >
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Ba dự đoán hàng đầu từ mô hình
        </h3>
        <ConfidenceLanes predictions={result.top3} uncertain={uncertain} />
        <div className="mt-5 grid gap-3 sm:grid-cols-2 sm:items-start">
          <ExplainButton image={image} camera={camera} onOpenChange={setExplainOpen} />
          <SportArButton
            label={currentLabel}
            confidence={result.confidence}
            isUncertain={uncertain}
            otherDialogOpen={explainOpen}
            onOpen={onOpenAr}
          />
        </div>
      </div>

      <CorrectSportDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        currentLabel={currentLabel}
        onSelect={(newLabel) => void handleCorrect(newLabel)}
      />
    </section>
  )
}
