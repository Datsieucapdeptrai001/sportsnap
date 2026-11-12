import { useState } from 'react'
import { ChartNoAxesCombined, Layers, ScanLine } from 'lucide-react'
import { Toaster } from 'sonner'
import { BrandMark } from './components/brand-mark'
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
    <div className="min-h-svh md:pl-60">
      <a href="#main-content" className="sr-only z-50 rounded-xl bg-card p-4 focus:not-sr-only focus:fixed focus:left-4 focus:top-4">
        Đến nội dung chính
      </a>
      <aside className="border-b border-border bg-card px-4 py-3 md:fixed md:inset-y-0 md:left-0 md:flex md:w-60 md:flex-col md:border-r md:border-b-0 md:px-4 md:py-6">
        <a href="#" onClick={() => setActiveTab('scan')} aria-label="SportSnap, trang Quét" className="inline-flex items-center gap-3 rounded-xl md:px-2">
          <BrandMark className="size-9 shrink-0" />
          <span className="text-lg font-semibold tracking-tight">SportSnap</span>
        </a>
        <nav aria-label="Điều hướng chính" className="fixed inset-x-0 bottom-0 z-30 flex border-t border-border bg-card pb-[env(safe-area-inset-bottom)] md:static md:mt-10 md:flex-col md:gap-1 md:border-0 md:pb-0">
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
                {/* Active marker: a painted lane line on top (mobile) or left (desktop). */}
                <span aria-hidden="true" className={cn('absolute inset-x-5 top-0 h-[3px] rounded-b-full bg-primary md:inset-x-auto md:inset-y-2 md:left-0 md:h-auto md:w-[3px] md:rounded-r-full md:rounded-bl-none', !current && 'hidden')} />
                <Icon size={20} aria-hidden="true" />
                {label}
              </button>
            )
          })}
        </nav>
        <p className="mt-auto hidden px-2 text-xs leading-relaxed text-muted-foreground md:block">
          Ảnh chỉ được gửi đến hệ thống để nhận diện.
        </p>
      </aside>
      <main id="main-content" className="mx-auto max-w-3xl px-4 pt-6 pb-[calc(6rem+env(safe-area-inset-bottom))] sm:px-8 md:py-12">
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
