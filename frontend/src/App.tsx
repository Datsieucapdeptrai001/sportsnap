import { useState } from 'react'
import { Activity, ChartNoAxesCombined, Layers, ScanLine } from 'lucide-react'
import { Toaster } from 'sonner'
import { SportCanvasBackground } from './components/sport-canvas-background'
import { cn } from './lib/utils'
import { ScanPage } from './pages/scan'
import { BulkPage } from './pages/bulk'
import { InsightsPage } from './pages/insights'

const tabs = [
  { id: 'scan', label: 'Quét', icon: ScanLine },
  { id: 'bulk', label: 'Phân loại hàng loạt', icon: Layers },
  { id: 'insights', label: 'Phân tích', icon: ChartNoAxesCombined },
] as const

function App() {
  const [activeTab, setActiveTab] = useState<(typeof tabs)[number]['id']>('scan')

  return (
    <div className="relative isolate min-h-svh md:pl-64">
      <SportCanvasBackground />
      <a href="#main-content" className="sr-only z-50 rounded-xl bg-card p-4 focus:not-sr-only focus:fixed focus:left-4 focus:top-4">
        Đến nội dung chính
      </a>
      <aside className="border-b border-white/10 bg-slate-950/45 px-5 py-4 text-slate-50 md:fixed md:inset-y-0 md:left-0 md:flex md:w-64 md:flex-col md:border-r md:border-b-0 md:p-6 md:backdrop-blur-md">
        <a href="#" onClick={() => setActiveTab('scan')} aria-label="SportSnap — trang Quét" className="inline-flex items-center gap-3 rounded-xl">
          <span className="flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Activity size={25} aria-hidden="true" />
          </span>
          <span>
            <span className="block text-xl font-bold tracking-tight">SportSnap<span className="text-emerald-300">.</span></span>
            <span className="block text-xs text-slate-300">Khám phá thể thao qua ảnh</span>
          </span>
        </a>
        <nav aria-label="Điều hướng chính" className="fixed inset-x-0 bottom-0 z-30 flex border-t border-white/10 bg-slate-950/85 px-2 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] backdrop-blur-md md:static md:mt-12 md:flex-col md:gap-2 md:border-0 md:bg-transparent md:p-0 md:backdrop-blur-none">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              aria-current={activeTab === id ? 'page' : undefined}
              onClick={() => setActiveTab(id)}
              className={cn(
                'flex min-h-14 flex-1 flex-col items-center justify-center gap-1 rounded-xl px-2 py-2 text-[11px] font-medium transition-all duration-200 motion-safe:hover:scale-[1.01] motion-safe:active:scale-[0.98] md:min-h-12 md:flex-none md:flex-row md:justify-start md:gap-3 md:px-3 md:text-sm',
                activeTab === id ? 'bg-emerald-400/10 text-emerald-300' : 'text-slate-300 hover:bg-white/5 hover:text-white',
              )}
            >
              <Icon size={21} aria-hidden="true" />
              {label}
            </button>
          ))}
        </nav>
        <p className="mt-auto hidden border-t border-white/10 pt-5 text-xs leading-relaxed text-slate-300 md:block">
          Mỗi bức ảnh,<br />một góc nhìn về thể thao.
        </p>
      </aside>
      <main id="main-content" className="relative mx-auto max-w-[784px] px-4 pt-8 pb-[calc(7rem+env(safe-area-inset-bottom))] sm:px-8 md:py-12">
        <div hidden={activeTab !== 'scan'}>
          <ScanPage active={activeTab === 'scan'} />
        </div>
        <div hidden={activeTab !== 'bulk'}>
          <BulkPage active={activeTab === 'bulk'} />
        </div>
        {activeTab === 'insights' && <InsightsPage />}
      </main>
      <Toaster richColors theme="system" closeButton toastOptions={{ className: 'font-sans' }} />
    </div>
  )
}

export default App
