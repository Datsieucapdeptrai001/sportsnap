import { useEffect, useState } from 'react'
import { Activity, RefreshCw } from 'lucide-react'
import { Toaster, toast } from 'sonner'
import { Card } from './components/ui/card'
import { getHealth, type HealthResponse } from './lib/api'

function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null)
  const [error, setError] = useState(false)
  const [loading, setLoading] = useState(true)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    getHealth(controller.signal)
      .then((result) => {
        setHealth(result)
        setLoading(false)
      })
      .catch(() => {
        if (controller.signal.aborted) return
        setError(true)
        setLoading(false)
        toast.error('Không thể kết nối đến hệ thống.')
      })
    return () => controller.abort()
  }, [attempt])

  function retry() {
    setLoading(true)
    setError(false)
    setHealth(null)
    setAttempt((value) => value + 1)
  }

  return (
    <main className="mx-auto flex min-h-svh max-w-[720px] flex-col justify-center gap-6 px-6 py-12">
      <header>
        <div className="mb-4 flex items-center gap-3 text-primary">
          <Activity aria-hidden="true" size={28} />
          <span className="text-xl font-semibold">SportSnap</span>
        </div>
        <h1 className="text-3xl font-semibold tracking-tight">Nhận diện môn thể thao qua ảnh</h1>
        <p className="mt-3 text-muted-foreground">Nền tảng đã sẵn sàng để phát triển các tính năng nhận diện.</p>
      </header>
      <Card aria-label="Trạng thái hệ thống" aria-busy={loading}>
        <h2 className="text-lg font-semibold">Trạng thái hệ thống</h2>
        <div role="status" aria-live="polite" className="my-4 text-muted-foreground">
          {loading ? (
            <>
              <p>Đang kiểm tra kết nối…</p>
              <div className="mt-3 h-5 w-3/4 rounded bg-muted motion-safe:animate-pulse" aria-hidden="true" />
            </>
          ) : error ? (
            <p className="text-destructive">Không thể kết nối. Vui lòng kiểm tra mạng và thử lại.</p>
          ) : health?.model_loaded ? (
            <p className="text-primary">Hệ thống đã kết nối. Mô hình nhận diện đã được tải.</p>
          ) : health?.reason === 'model_missing' ? (
            <p>Hệ thống đã kết nối. Chưa có đủ tệp mô hình để nhận diện.</p>
          ) : (
            <p className="text-destructive">Hệ thống đã kết nối nhưng chưa tải được mô hình nhận diện.</p>
          )}
        </div>
        <button
          type="button"
          onClick={retry}
          disabled={loading}
          className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-primary px-4 py-2 font-medium text-primary-foreground disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary"
        >
          <RefreshCw size={16} aria-hidden="true" />
          Kiểm tra lại
        </button>
      </Card>
      <Toaster richColors />
    </main>
  )
}

export default App
