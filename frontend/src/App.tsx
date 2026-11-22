import { useCallback, useEffect, useState } from 'react'
import { ChartNoAxesCombined, Database, Layers, LogOut, Monitor, Moon, ScanLine, Sun, Wrench } from 'lucide-react'
import { Toaster, toast } from 'sonner'
import { BrandMark } from './components/brand-mark'
import { ModelSelector } from './components/model-selector'
import { SportCanvasBackground } from './components/sport-canvas-background'
import { getModels, selectModel, isDevAuthenticated, setDevToken, type ModelInfo } from './lib/api'
import { cn } from './lib/utils'
import { ScanPage } from './pages/scan'
import { BulkPage } from './pages/bulk'
import { InsightsPage } from './pages/insights'
import { LibraryPage } from './pages/library'

const tabs = [
  { id: 'scan', label: 'Quét', icon: ScanLine },
  { id: 'library', label: 'Thư viện', icon: Database },
  { id: 'bulk', label: 'Phân loại hàng loạt', icon: Layers },
  { id: 'insights', label: 'Phân tích', icon: ChartNoAxesCombined },
] as const

type ThemeMode = 'system' | 'light' | 'dark'
const THEME_KEY = 'sportsnap.theme'

function readTheme(): ThemeMode {
  try {
    const v = localStorage.getItem(THEME_KEY)
    if (v === 'light' || v === 'dark' || v === 'system') return v
  } catch { /* ignore */ }
  return 'system'
}

const THEME_LABELS: Record<ThemeMode, string> = {
  system: 'Hệ thống',
  light: 'Sáng',
  dark: 'Tối',
}

function App() {
  const [isDevMode, setIsDevMode] = useState<boolean>(() => isDevAuthenticated())
  const [activeTab, setActiveTab] = useState<(typeof tabs)[number]['id']>('scan')
  const [theme, setTheme] = useState<ThemeMode>(readTheme)
  const [models, setModels] = useState<ModelInfo[]>([])
  const [activeModelId, setActiveModelId] = useState<string | null>(null)
  const [loadingModels, setLoadingModels] = useState(true)
  const [switchingModel, setSwitchingModel] = useState(false)
  const [modelsError, setModelsError] = useState('')
  const [modelsAttempt, setModelsAttempt] = useState(0)

  useEffect(() => {
    const root = document.documentElement
    if (theme === 'system') root.removeAttribute('data-theme')
    else root.setAttribute('data-theme', theme)
    try {
      localStorage.setItem(THEME_KEY, theme)
    } catch { /* ignore */ }
  }, [theme])

  function cycleTheme() {
    setTheme((cur) => (cur === 'system' ? 'dark' : cur === 'dark' ? 'light' : 'system'))
  }

  // Hotkey Ctrl+Shift+D or Cmd+Shift+D to open dev mode prompt
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'd') {
        e.preventDefault()
        if (isDevMode) {
          setDevToken(null)
          setIsDevMode(false)
          toast.info('Đã thoát Chế độ Nhà phát triển.')
          setModelsAttempt((prev) => prev + 1)
        } else {
          const token = window.prompt('Nhập mã nhà phát triển (X-Dev-Token):')
          if (token && token.trim()) {
            setDevToken(token.trim())
            setIsDevMode(true)
            toast.success('Đã bật Chế độ Nhà phát triển.')
            setModelsAttempt((prev) => prev + 1)
          }
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isDevMode])

  useEffect(() => {
    const controller = new AbortController()
    setLoadingModels(true)
    setModelsError('')
    getModels(controller.signal)
      .then((data) => {
        if (controller.signal.aborted) return
        setModels(data.models)
        setActiveModelId(data.active_model_id)
        setLoadingModels(false)
      })
      .catch((error) => {
        if (controller.signal.aborted) return
        setModelsError(error instanceof Error ? error.message : 'Không thể tải danh sách mô hình.')
        setLoadingModels(false)
      })
    return () => controller.abort()
  }, [modelsAttempt])

  const handleSelectModel = useCallback(async (modelId: string) => {
    setSwitchingModel(true)
    try {
      const result = await selectModel(modelId)
      setActiveModelId(result.active_model_id)
      setModels((prev) =>
        prev.map((item) => ({ ...item, active: item.id === result.active_model_id })),
      )
      toast.success(`Đã chuyển sang ${result.model.name}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Không thể chuyển mô hình.')
    } finally {
      setSwitchingModel(false)
    }
  }, [])

  const handleExitDevMode = () => {
    setDevToken(null)
    setIsDevMode(false)
    toast.info('Đã chuyển về giao diện người dùng tiêu chuẩn.')
    setModelsAttempt((prev) => prev + 1)
  }

  const handleTriggerDevMode = () => {
    const token = window.prompt('Nhập mã nhà phát triển (X-Dev-Token):')
    if (token && token.trim()) {
      setDevToken(token.trim())
      setIsDevMode(true)
      toast.success('Đã bật Chế độ Nhà phát triển.')
      setModelsAttempt((prev) => prev + 1)
    }
  }

  const ThemeIcon = theme === 'dark' ? Moon : theme === 'light' ? Sun : Monitor

  return (
    <div className="relative min-h-svh md:pl-60">
      <SportCanvasBackground />
      <a href="#main-content" className="sr-only z-50 rounded-xl bg-card p-4 focus:not-sr-only focus:fixed focus:left-4 focus:top-4">
        Đến nội dung chính
      </a>
      <aside className="z-20 border-b border-border bg-card/95 px-4 py-3 backdrop-blur-md md:fixed md:inset-y-0 md:left-0 md:flex md:w-60 md:flex-col md:border-r md:border-b-0 md:px-4 md:py-6">
        <div className="flex items-center justify-between gap-2">
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault()
              setActiveTab('scan')
            }}
            onDoubleClick={handleTriggerDevMode}
            title="Nhấp đúp hoặc bấm Ctrl+Shift+D để mở chế độ nhà phát triển"
            aria-label="SportSnap, trang Quét"
            className="inline-flex items-center gap-3 rounded-xl md:px-2"
          >
            <BrandMark className="size-9 shrink-0" />
            <span className="text-lg font-semibold tracking-tight">SportSnap</span>
          </a>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={cycleTheme}
              aria-label={`Đổi giao diện (hiện tại: ${THEME_LABELS[theme]})`}
              title={`Giao diện: ${THEME_LABELS[theme]}`}
              className="inline-flex size-9 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground hover:border-primary/50 hover:text-foreground md:hidden"
            >
              <ThemeIcon size={16} aria-hidden="true" />
            </button>
            {isDevMode && (
              <button
                type="button"
                onClick={handleExitDevMode}
                title="Thoát Chế độ Nhà phát triển"
                className="inline-flex items-center gap-1 rounded-md bg-amber-500/10 px-2 py-1 text-[11px] font-medium text-amber-500 hover:bg-amber-500/20 md:hidden"
              >
                <LogOut size={12} /> Thoát
              </button>
            )}
          </div>
        </div>

        {isDevMode && (
          <div className="mt-3 hidden items-center justify-between rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-400 md:flex">
            <span className="inline-flex items-center gap-1 font-medium">
              <Wrench size={13} /> Chế độ Dev
            </span>
            <button
              type="button"
              onClick={handleExitDevMode}
              className="rounded px-1.5 py-0.5 text-[11px] underline hover:bg-amber-500/20"
            >
              Thoát
            </button>
          </div>
        )}

        <nav aria-label="Điều hướng chính" className="fixed inset-x-0 bottom-0 z-30 flex border-t border-border bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:static md:mt-8 md:flex-col md:gap-1 md:border-0 md:pb-0">
          {tabs.map(({ id, label, icon: Icon }) => {
            const current = activeTab === id
            return (
              <button
                key={id}
                type="button"
                aria-current={current ? 'page' : undefined}
                onClick={() => setActiveTab(id)}
                className={cn(
                  'relative flex min-h-16 flex-1 flex-col items-center justify-center gap-1 px-1 text-xs font-medium transition-colors duration-150 md:min-h-11 md:flex-none md:flex-row md:justify-start md:gap-3 md:rounded-xl md:px-3 md:text-sm',
                  current ? 'text-primary md:bg-primary-soft' : 'text-muted-foreground hover:text-foreground md:hover:bg-muted',
                )}
              >
                <span aria-hidden="true" className={cn('absolute inset-x-5 top-0 h-[3px] rounded-b-full bg-primary md:inset-x-auto md:inset-y-2 md:left-0 md:h-auto md:w-[3px] md:rounded-r-full md:rounded-bl-none', !current && 'hidden')} />
                <Icon size={20} aria-hidden="true" />
                {label}
              </button>
            )
          })}
        </nav>

        <div className="mt-auto hidden space-y-3 md:block">
          <button
            type="button"
            onClick={cycleTheme}
            className="flex min-h-10 w-full items-center justify-between rounded-xl border border-border bg-card px-3 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
          >
            <span className="inline-flex items-center gap-2">
              <ThemeIcon size={15} aria-hidden="true" />
              Giao diện
            </span>
            <span className="text-foreground">{THEME_LABELS[theme]}</span>
          </button>
          <p className="px-2 text-xs leading-relaxed text-muted-foreground">
            Ảnh chỉ được gửi đến hệ thống để nhận diện.
          </p>
        </div>
      </aside>
      <main id="main-content" className={cn('relative mx-auto px-4', activeTab === 'scan' || activeTab === 'library' || activeTab === 'insights' ? 'max-w-6xl' : 'max-w-3xl', 'pt-6 pb-[calc(6rem+env(safe-area-inset-bottom))] sm:px-8 md:py-12')}>
        {isDevMode && (activeTab === 'scan' || activeTab === 'bulk') && (
          <ModelSelector
            models={models}
            activeModelId={activeModelId}
            loading={loadingModels}
            switching={switchingModel}
            error={modelsError}
            onSelect={(id) => void handleSelectModel(id)}
            onRetry={() => setModelsAttempt((value) => value + 1)}
          />
        )}
        <div hidden={activeTab !== 'scan'}>
          <ScanPage active={activeTab === 'scan'} activeModelId={isDevMode ? activeModelId : null} isDevMode={isDevMode} />
        </div>
        <div hidden={activeTab !== 'library'}>
          <LibraryPage active={activeTab === 'library'} />
        </div>
        <div hidden={activeTab !== 'bulk'}>
          <BulkPage active={activeTab === 'bulk'} />
        </div>
        {activeTab === 'insights' && <InsightsPage />}
      </main>
      <Toaster position="top-center" richColors theme={theme} closeButton toastOptions={{ className: 'font-sans' }} />
    </div>
  )
}

export default App
