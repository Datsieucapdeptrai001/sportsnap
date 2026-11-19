import { test, expect } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promises as fs } from 'node:fs'
import {
  openArDialog,
  startGame,
  getGameSnapshot,
  swipeShoot,
  waitForTimingHit,
  tapMashFast,
  tapMashSlow,
  shootBasketball,
  setupCameraTracking,
  setupMockApi,
  recordReportEntry,
} from './helpers'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPORT_DIR = path.resolve(__dirname, '..', 'e2e-report')

test.beforeAll(async () => {
  await fs.mkdir(REPORT_DIR, { recursive: true })
})

test.describe('Interactive AR Games - All 20 Sports', () => {
  test.beforeEach(async ({ page }) => {
    // Monitor console errors and unhandled exceptions
    const consoleErrors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text()
        // Ignore expected model-viewer 404s for unmapped 3D assets in test environment
        if (!text.includes('model-viewer') && !text.includes('404')) {
          consoleErrors.push(text)
        }
      }
    })
    page.on('pageerror', (err) => {
      consoleErrors.push(err.message)
    })
    ;(page as unknown as { __errors: string[] }).__errors = consoleErrors

    await setupCameraTracking(page)
  })

  test.afterEach(async ({ page }) => {
    const errors = (page as unknown as { __errors?: string[] }).__errors || []
    expect(errors, `Unexpected errors occurred: ${errors.join('; ')}`).toEqual([])
  })

  // -------------------------------------------------------------------------
  // 1. Basketball (Dedicated Three.js Game)
  // -------------------------------------------------------------------------
  test('sport: basketball (Three.js physics)', async ({ page }) => {
    await setupMockApi(page, 'basketball')
    await page.goto('/?e2e=1')
    await openArDialog(page, 'basketball')

    let shotsFlew = 0
    let goals = 0

    for (let shot = 0; shot < 5; shot++) {
      // Wait for ball to be ready
      await expect.poll(async () => {
        const snap = await getGameSnapshot(page)
        return snap?.ballState
      }, { timeout: 6000 }).toBe('idle')

      // Shoot
      await shootBasketball(page)

      // Verify ball flew
      await expect.poll(async () => {
        const snap = await getGameSnapshot(page)
        return snap?.ballState
      }, { timeout: 3000 }).not.toBe('idle')
      shotsFlew++

      // Wait for shot completion
      await page.waitForTimeout(1000)
      const currentSnap = await getGameSnapshot(page)
      if (currentSnap && currentSnap.score > 0) {
        goals = currentSnap.score
      }
    }

    expect(shotsFlew).toBe(5)

    // Verify localStorage record (recorded if goals were scored)
    const bestInStorage = await page.evaluate(() => localStorage.getItem('sportsnap.ar-best.basketball'))
    if (goals > 0) {
      expect(bestInStorage).not.toBeNull()
    }

    // Test Play Again button
    const resetBtn = page.locator('dialog[open] button[aria-label="Chơi lại"]')
    if (await resetBtn.isVisible()) {
      await resetBtn.click()
      await expect.poll(async () => {
        const snap = await getGameSnapshot(page)
        return snap?.score
      }).toBe(0)
    }

    await page.screenshot({ path: path.join(REPORT_DIR, 'basketball.png') })
    await recordReportEntry({
      sport: 'basketball',
      scenario: '5 shots flight and goal test',
      measured: { shotsFlew, goals, bestScore: bestInStorage },
      passed: shotsFlew === 5,
    })
  })

  // -------------------------------------------------------------------------
  // 2. Shoot Mode (7 sports)
  // -------------------------------------------------------------------------
  const SHOOT_SPORTS = [
    { label: 'football', static: true },
    { label: 'golf', static: true },
    { label: 'hockey', static: false },
    { label: 'field hockey', static: false },
    { label: 'archery', static: false },
    { label: 'polo', static: false },
    { label: 'volleyball', static: false },
  ]

  for (const item of SHOOT_SPORTS) {
    test(`sport: ${item.label} (mode: shoot)`, async ({ page }) => {
      await setupMockApi(page, item.label)
      await page.goto('/?e2e=1')
      await openArDialog(page, item.label)

      const initialSnap = await getGameSnapshot(page)
      expect(initialSnap?.phase).toBe('ready')

      await startGame(page)

      await expect.poll(async () => {
        const snap = await getGameSnapshot(page)
        return snap?.phase
      }).toBe('playing')

      // Play 8 rounds
      for (let attempt = 0; attempt < 8; attempt++) {
        const snap = await getGameSnapshot(page)
        if (!snap || snap.phase !== 'playing') break
        const tx = snap.targetX ?? 0.5
        await swipeShoot(page, tx)
      }

      // Wait for game over
      await expect.poll(async () => {
        const snap = await getGameSnapshot(page)
        return snap?.phase
      }, { timeout: 6000 }).toBe('over')

      const finalSnap = await getGameSnapshot(page)
      expect(finalSnap?.phase).toBe('over')

      // For static sports, require >= 6 hits (12 points)
      if (item.static) {
        expect(finalSnap!.score).toBeGreaterThanOrEqual(12)
      }

      // Check localStorage if points were scored
      const best = await page.evaluate((lbl) => localStorage.getItem(`sportsnap.ar-best.${lbl}`), item.label)
      if ((finalSnap?.score ?? 0) > 0) {
        expect(best).not.toBeNull()
      }

      // Test reset button
      await page.locator('dialog[open] button:has-text("Chơi lại")').click()
      await expect.poll(async () => {
        const s = await getGameSnapshot(page)
        return s?.phase
      }).toBe('playing')

      await page.screenshot({ path: path.join(REPORT_DIR, `${item.label}.png`) })
      await recordReportEntry({
        sport: item.label,
        scenario: '8 attempts swipe accuracy',
        measured: { finalScore: finalSnap?.score, bestRecord: best, staticTarget: item.static },
        passed: item.static ? (finalSnap?.score ?? 0) >= 12 : finalSnap?.phase === 'over',
      })
    })
  }

  // -------------------------------------------------------------------------
  // 3. Timing Mode (5 sports)
  // -------------------------------------------------------------------------
  const TIMING_SPORTS = [
    { label: 'baseball' },
    { label: 'tennis' },
    { label: 'high jump' },
    { label: 'uneven bars' },
    { label: 'figure skating women' },
  ]

  for (const item of TIMING_SPORTS) {
    test(`sport: ${item.label} (mode: timing)`, async ({ page }) => {
      await setupMockApi(page, item.label)
      await page.goto('/?e2e=1')
      await openArDialog(page, item.label)

      await startGame(page)
      await expect.poll(async () => {
        const snap = await getGameSnapshot(page)
        return snap?.phase
      }).toBe('playing')

      for (let attempt = 0; attempt < 8; attempt++) {
        const snap = await getGameSnapshot(page)
        if (!snap || snap.phase !== 'playing') break
        await waitForTimingHit(page)
      }

      await expect.poll(async () => {
        const snap = await getGameSnapshot(page)
        return snap?.phase
      }, { timeout: 6000 }).toBe('over')

      const finalSnap = await getGameSnapshot(page)
      expect(finalSnap?.phase).toBe('over')
      // At least 6/8 hits non-missed (at least 6 points)
      expect(finalSnap!.score).toBeGreaterThanOrEqual(6)

      const best = await page.evaluate((lbl) => localStorage.getItem(`sportsnap.ar-best.${lbl}`), item.label)
      expect(best).not.toBeNull()

      await page.screenshot({ path: path.join(REPORT_DIR, `${item.label}.png`) })
      await recordReportEntry({
        sport: item.label,
        scenario: '8 attempts timing reaction',
        measured: { finalScore: finalSnap?.score, bestRecord: best },
        passed: (finalSnap?.score ?? 0) >= 6,
      })
    })
  }

  // -------------------------------------------------------------------------
  // 4. Mash Mode (7 sports) - Fast (Win) & Slow (Lose)
  // -------------------------------------------------------------------------
  const MASH_SPORTS = [
    { label: 'swimming', goal: 42 },
    { label: 'canoe slamon', goal: 38 },
    { label: 'rollerblade racing', goal: 42 },
    { label: 'roller derby', goal: 42 },
    { label: 'formula 1 racing', goal: 48 },
    { label: 'olympic wrestling', goal: 38 },
    { label: 'boxing', goal: 35 },
  ]

  for (const item of MASH_SPORTS) {
    test(`sport: ${item.label} (mode: mash fast -> win, slow -> lose)`, async ({ page }) => {
      // Test 1: Fast tapping -> WIN
      await setupMockApi(page, item.label)
      await page.goto('/?e2e=1')
      await openArDialog(page, item.label)

      await startGame(page)
      // Allow 700ms preparation
      await page.waitForTimeout(750)

      const startFast = Date.now()
      await tapMashFast(page, item.goal + 5)
      const durationFastSec = (Date.now() - startFast) / 1000

      await expect.poll(async () => {
        const snap = await getGameSnapshot(page)
        return snap?.phase
      }, { timeout: 6000 }).toBe('over')

      const fastSnap = await getGameSnapshot(page)
      expect(fastSnap?.result).toBe('win')
      expect(fastSnap?.score).toBeGreaterThan(100)

      await page.screenshot({ path: path.join(REPORT_DIR, `${item.label}.png`) })

      // Test 2: Play again with slow tapping -> LOSE
      await page.locator('dialog[open] button:has-text("Chơi lại")').click()
      await page.waitForTimeout(750)

      const startSlow = Date.now()
      await tapMashSlow(page, 10500)
      const durationSlowSec = (Date.now() - startSlow) / 1000

      await expect.poll(async () => {
        const snap = await getGameSnapshot(page)
        return snap?.phase
      }, { timeout: 6000 }).toBe('over')

      const slowSnap = await getGameSnapshot(page)
      expect(slowSnap?.result).toBe('lose')

      await recordReportEntry({
        sport: item.label,
        scenario: 'mash fast (win) vs slow (lose)',
        measured: {
          fastResult: fastSnap?.result,
          fastScore: fastSnap?.score,
          fastDurationSec: durationFastSec.toFixed(1),
          slowResult: slowSnap?.result,
          slowScore: slowSnap?.score,
          slowDurationSec: durationSlowSec.toFixed(1),
        },
        passed: fastSnap?.result === 'win' && slowSnap?.result === 'lose',
      })
    })
  }
})
