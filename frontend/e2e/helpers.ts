import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPORT_DIR = path.resolve(__dirname, '..', 'e2e-report')
const REPORT_FILE = path.join(REPORT_DIR, 'results.json')

export const ALL_LABELS = [
  'archery', 'baseball', 'basketball', 'boxing', 'canoe slamon',
  'field hockey', 'figure skating pairs', 'figure skating women',
  'football', 'formula 1 racing', 'golf', 'high jump', 'hockey',
  'nascar racing', 'olympic wrestling', 'polo', 'rings', 'roller derby',
  'rollerblade racing', 'rugby', 'swimming', 'tennis', 'uneven bars', 'volleyball',
]

// 1x1 valid JPEG bytes
export const DUMMY_JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01,
  0x01, 0x00, 0x48, 0x00, 0x48, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43, 0x00, 0x08,
  0x06, 0x06, 0x07, 0x06, 0x05, 0x08, 0x07, 0x07, 0x07, 0x09, 0x09, 0x08, 0x0a,
  0x0c, 0x14, 0x0d, 0x0c, 0x0b, 0x0b, 0x0c, 0x19, 0x12, 0x13, 0x0f, 0x14, 0x1d,
  0x1a, 0x1f, 0x1e, 0x1d, 0x1a, 0x1c, 0x1c, 0x20, 0x24, 0x2e, 0x27, 0x20, 0x22,
  0x2c, 0x23, 0x1c, 0x1c, 0x28, 0x37, 0x29, 0x2c, 0x30, 0x31, 0x34, 0x34, 0x34,
  0x1f, 0x27, 0x39, 0x3d, 0x38, 0x32, 0x3c, 0x2e, 0x33, 0x34, 0x32, 0xff, 0xc0,
  0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xc4,
  0x00, 0x1f, 0x00, 0x00, 0x01, 0x05, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06,
  0x07, 0x08, 0x09, 0x0a, 0x0b, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00,
  0x3f, 0x00, 0xbf, 0x00, 0xff, 0xd9,
])

export interface ArGameSnapshot {
  label: string
  mode: string
  phase: 'ready' | 'playing' | 'over'
  score: number
  streak: number
  left: number | null
  result: 'win' | 'lose' | null
  best: number
  markerPos?: number
  zoneCenter?: number
  zoneWidth?: number
  targetX?: number
  targetY?: number
  ballState?: 'idle' | 'flying' | 'scored' | 'missed'
}

export interface E2eReportEntry {
  runId?: string
  sport: string
  scenario: string
  measured: Record<string, unknown>
  passed: boolean
}

export async function setupCameraTracking(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.__gumCalls = 0
    window.__tracks = []
    window.__gumFailures = []

    const originalGUM = navigator.mediaDevices ? navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices) : null
    if (navigator.mediaDevices && originalGUM) {
      navigator.mediaDevices.getUserMedia = async function (constraints: MediaStreamConstraints) {
        window.__gumCalls = (window.__gumCalls || 0) + 1
        if (Array.isArray(window.__gumFailures) && window.__gumFailures.length > 0) {
          const nextErr = window.__gumFailures.shift()
          if (nextErr) {
            throw new DOMException('Simulated getUserMedia error: ' + nextErr, nextErr)
          }
        }
        const stream = await originalGUM(constraints)
        for (const track of stream.getTracks()) {
          window.__tracks = window.__tracks || []
          window.__tracks.push(track)
        }
        return stream
      }
    }
  })
}

export async function setupMockApi(page: Page, targetLabel = 'basketball'): Promise<{ setLabel: (label: string) => void }> {
  let currentLabel = targetLabel

  await page.route('**/api/classes', (route) => {
    void route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ classes: ALL_LABELS }),
    })
  })

  await page.route('**/api/models', (route) => {
    void route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        active_model_id: 'default',
        models: [{
          id: 'default',
          name: 'ResNet50',
          description: 'Production model',
          preprocess: 'resnet50',
          num_classes: ALL_LABELS.length,
          size_mb: 26,
          active: true,
        }],
      }),
    })
  })

  await page.route('**/api/health', (route) => {
    void route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'ok',
        model_loaded: true,
        num_classes: ALL_LABELS.length,
        preprocess: 'resnet50',
      }),
    })
  })

  await page.route('**/api/predict**', (route) => {
    const others = ['golf', 'tennis', 'football', 'basketball'].filter((l) => l !== currentLabel)
    void route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        label: currentLabel,
        confidence: 0.99,
        is_uncertain: false,
        threshold: 0.5,
        latency_ms: 8,
        top3: [
          { label: currentLabel, confidence: 0.99 },
          { label: others[0], confidence: 0.005 },
          { label: others[1], confidence: 0.005 },
        ],
      }),
    })
  })

  await page.route('**/api/scan', (route) => {
    const others = ['golf', 'tennis', 'football', 'basketball'].filter((l) => l !== currentLabel)
    void route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        label: currentLabel,
        confidence: 0.99,
        is_uncertain: false,
        threshold: 0.5,
        latency_ms: 10,
        agreement: 1,
        per_frame: [{ label: currentLabel, confidence: 0.99 }],
        top3: [
          { label: currentLabel, confidence: 0.99 },
          { label: others[0], confidence: 0.005 },
          { label: others[1], confidence: 0.005 },
        ],
      }),
    })
  })

  return {
    setLabel: (label: string) => { currentLabel = label },
  }
}

export async function openArDialog(page: Page, label: string): Promise<void> {
  // Switch to gallery mode so CameraScanner stops holding camera
  const galleryBtn = page.locator('div[role="group"][aria-label="Chế độ nhận diện"] button:has-text("Thư viện")')
  if (await galleryBtn.isVisible()) {
    await galleryBtn.click()
  }

  const fileInput = page.locator('#scan-image')
  await fileInput.setInputFiles({
    name: `${label}.jpg`,
    mimeType: 'image/jpeg',
    buffer: DUMMY_JPEG,
  })

  const openBtn = page.locator('button:has-text("🎮 Chơi & xem AR"), button:has-text("🏀 Ném bóng rổ AR")').first()
  await openBtn.waitFor({ state: 'visible', timeout: 5000 })
  await openBtn.click()

  const dialog = page.locator('dialog[open]')
  await dialog.waitFor({ state: 'visible', timeout: 5000 })

  // Wait for either Three.js canvas or Canvas 2D
  await page.locator('dialog[open] canvas').first().waitFor({ state: 'attached', timeout: 5000 })
}

export async function startGame(page: Page): Promise<void> {
  const startBtn = page.locator('dialog[open] button:has-text("Bắt đầu")')
  if (await startBtn.isVisible()) {
    await startBtn.click()
  }
}

export async function getGameSnapshot(page: Page): Promise<ArGameSnapshot | null> {
  return await page.evaluate(() => {
    const fn = (window as unknown as { __SPORTSNAP_AR__?: () => ArGameSnapshot }).__SPORTSNAP_AR__
    return fn ? fn() : null
  })
}

export async function swipeShoot(page: Page, targetX: number): Promise<void> {
  await page.evaluate(async ({ tx }) => {
    const canvas = document.querySelector('dialog[open] canvas') as HTMLCanvasElement
    if (!canvas) return

    const rect = canvas.getBoundingClientRect()
    const startX = rect.left + rect.width / 2
    const startY = rect.bottom - 40

    // For TARGET_Y = 0.3: power = 0.75, speed = 1.9 px/ms
    // Let |dy| = 100px -> dt = 100 / 1.9 = ~52.6ms -> 50ms
    const dy = -100
    const dt = 50
    const lean = Math.max(-1, Math.min(1, (tx - 0.5) * 2))
    const dx = lean * Math.abs(dy)

    canvas.dispatchEvent(new PointerEvent('pointerdown', {
      clientX: startX,
      clientY: startY,
      pointerId: 1,
      bubbles: true,
      cancelable: true,
    }))

    await new Promise((resolve) => setTimeout(resolve, dt))

    window.dispatchEvent(new PointerEvent('pointerup', {
      clientX: startX + dx,
      clientY: startY + dy,
      pointerId: 1,
      bubbles: true,
      cancelable: true,
    }))
  }, { tx: targetX })

  // Allow flight animation to finish (SHOOT_FLIGHT_MS = 650 + margin)
  await page.waitForTimeout(800)
}

export async function tapTiming(page: Page): Promise<void> {
  await page.keyboard.press('Space')
  await page.waitForTimeout(200)
}

export async function waitForTimingHit(page: Page): Promise<void> {
  await page.evaluate(async () => {
    return new Promise<void>((resolve) => {
      const start = performance.now()
      function check(now: number) {
        const getSnap = (window as unknown as { __SPORTSNAP_AR__?: () => { phase: string; markerPos: number; zoneCenter: number; zoneWidth: number } }).__SPORTSNAP_AR__
        const snap = getSnap?.()
        if (!snap || snap.phase !== 'playing' || (now - start > 6000)) {
          resolve()
          return
        }
        if (Math.abs(snap.markerPos - snap.zoneCenter) <= snap.zoneWidth * 0.3) {
          window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true }))
          resolve()
          return
        }
        requestAnimationFrame(check)
      }
      requestAnimationFrame(check)
    })
  })
  // Allow frozen delay (700ms) to complete before next round
  await page.waitForTimeout(750)
}

export async function tapMashFast(page: Page, totalTaps: number): Promise<void> {
  // 6 taps/sec -> interval ~160ms
  for (let i = 0; i < totalTaps; i++) {
    await page.keyboard.press('Space')
    await page.waitForTimeout(160)
    const snap = await getGameSnapshot(page)
    if (snap && snap.phase === 'over') break
  }
}

export async function tapMashSlow(page: Page, durationMs = 11000): Promise<void> {
  // 2 taps/sec -> interval ~500ms
  const start = Date.now()
  while (Date.now() - start < durationMs) {
    await page.keyboard.press('Space')
    await page.waitForTimeout(500)
    const snap = await getGameSnapshot(page)
    if (snap && snap.phase === 'over') break
  }
}

export async function shootBasketball(page: Page, targetSpeed = 1.70): Promise<void> {
  await page.evaluate(async ({ speed }) => {
    const container = document.querySelector('dialog[open] canvas')?.parentElement
    if (!container) return

    const rect = container.getBoundingClientRect()
    const startX = rect.left + rect.width / 2
    const startY = rect.bottom - 60

    let tDown = performance.now()
    const onDown = () => { tDown = performance.now() }
    window.addEventListener('pointerdown', onDown, { capture: true, once: true })

    container.dispatchEvent(new PointerEvent('pointerdown', {
      clientX: startX,
      clientY: startY,
      pointerId: 1,
      bubbles: true,
    }))

    await new Promise((resolve) => setTimeout(resolve, 80))

    // Dynamically calculate dy so swipeSpeedY is exactly speed px/ms regardless of timer jitter
    const elapsed = Math.max(performance.now() - tDown, 40)
    const dy = -speed * elapsed

    window.dispatchEvent(new PointerEvent('pointerup', {
      clientX: startX,
      clientY: startY + dy,
      pointerId: 1,
      bubbles: true,
    }))
  }, { speed: targetSpeed })

  // Wait for initial flight
  await page.waitForTimeout(500)
}

export async function recordReportEntry(entry: E2eReportEntry): Promise<void> {
  try {
    await fs.mkdir(REPORT_DIR, { recursive: true })
    let entries: E2eReportEntry[] = []
    try {
      const existing = await fs.readFile(REPORT_FILE, 'utf8')
      entries = JSON.parse(existing) as E2eReportEntry[]
    } catch {
      entries = []
    }
    const withRunId: E2eReportEntry = {
      runId: entry.runId || process.env.SPORTSNAP_E2E_RUN_ID || new Date().toISOString(),
      ...entry,
    }
    entries.push(withRunId)
    await fs.writeFile(REPORT_FILE, JSON.stringify(entries, null, 2), 'utf8')
  } catch (err) {
    console.warn('Could not record report entry:', err)
  }
}
