import { useState } from 'react'
import { Activity, ChartNoAxesCombined, Layers, ScanLine } from 'lucide-react'
import { Toaster } from 'sonner'
import { Card } from './components/ui/card'
import { cn } from './lib/utils'
import { ScanPage } from './pages/scan'

const tabs = [
  { id: 'scan', label: 'Quét', icon: ScanLine },
  { id: 'bulk', label: 'Phân loại hàng loạt', icon: Layers },
  { id: 'insights', label: 'Phân tích', icon: ChartNoAxesCombined },
] as const

function App() {
  const [activeTab, setActiveTab] = useState<(typeof tabs)[number]['id']>('scan')
  const currentTab = tabs.find((tab) => tab.id === activeTab)!

  return (
    <div className="relative isolate min-h-svh md:pl-64">
      <div aria-hidden="true" className="ambient-mesh" />
      <a href="#main-content" className="sr-only z-50 rounded-xl bg-card p-4 focus:not-sr-only focus:fixed focus:left-4 focus:top-4">
        Đến nội dung chính
      </a>
      <aside className="border-b border-border/60 bg-card/70 px-5 py-4 md:fixed md:inset-y-0 md:left-0 md:flex md:w-64 md:flex-col md:border-r md:border-b-0 md:p-6 md:backdrop-blur-md">
        <a href="#" onClick={() => setActiveTab('scan')} aria-label="SportSnap — trang Quét" className="inline-flex items-center gap-3 rounded-xl">
          <span className="flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Activity size={25} aria-hidden="true" />
          </span>
          <span>
            <span className="block text-xl font-bold tracking-tight">SportSnap<span className="text-primary">.</span></span>
            <span className="block text-xs text-muted-foreground">Khám phá thể thao qua ảnh</span>
          </span>
        </a>
        <nav aria-label="Điều hướng chính" className="fixed inset-x-0 bottom-0 z-30 flex border-t border-border/60 bg-card/85 px-2 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] backdrop-blur-md md:static md:mt-12 md:flex-col md:gap-2 md:border-0 md:bg-transparent md:p-0 md:backdrop-blur-none">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              aria-current={activeTab === id ? 'page' : undefined}
              onClick={() => setActiveTab(id)}
              className={cn(
                'flex min-h-14 flex-1 flex-col items-center justify-center gap-1 rounded-xl px-2 py-2 text-[11px] font-medium transition-all duration-200 motion-safe:hover:scale-[1.01] motion-safe:active:scale-[0.98] md:min-h-12 md:flex-none md:flex-row md:justify-start md:gap-3 md:px-3 md:text-sm',
                activeTab === id ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              <Icon size={21} aria-hidden="true" />
              {label}
            </button>
          ))}
        </nav>
        <p className="mt-auto hidden border-t border-border pt-5 text-xs leading-relaxed text-muted-foreground md:block">
          Mỗi bức ảnh,<br />một góc nhìn về thể thao.
        </p>
      </aside>
      <main id="main-content" className="glass-surface relative mx-3 my-6 max-w-[784px] rounded-3xl border px-4 pt-8 pb-[calc(7rem+env(safe-area-inset-bottom))] sm:mx-6 sm:px-8 md:mx-auto md:my-8 md:py-10">
        <div hidden={activeTab !== 'scan'}>
          <ScanPage />
        </div>
        {activeTab !== 'scan' && (
          <div>
            <p className="mb-3 text-xs font-semibold tracking-widest text-primary uppercase">SportSnap</p>
            <h1 className="text-3xl font-semibold tracking-tight">{currentTab.label}</h1>
            <Card className="mt-8 py-14 text-center">
              <currentTab.icon className="mx-auto mb-5 text-primary" size={36} aria-hidden="true" />
              <h2 className="text-xl font-semibold">Tính năng đang được phát triển</h2>
              <p className="mt-3 text-sm text-muted-foreground">
                {activeTab === 'bulk' ? 'Phân loại nhiều ảnh cùng lúc sẽ sớm có mặt.' : 'Kết quả thí nghiệm và phân tích mô hình sẽ có tại đây.'}
              </p>
              <button type="button" className="mt-6 min-h-11 rounded-xl px-4 text-sm font-medium text-primary transition-all duration-200 hover:bg-primary/10 motion-safe:hover:scale-[1.01] motion-safe:active:scale-[0.98]" onClick={() => setActiveTab('scan')}>
                Trở về Quét
              </button>
            </Card>
          </div>
        )}
      </main>
      <Toaster richColors theme="system" closeButton toastOptions={{ className: 'font-sans' }} />
    </div>
  )
}

export default App
