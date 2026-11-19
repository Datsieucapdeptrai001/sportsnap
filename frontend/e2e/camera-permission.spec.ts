import { test, expect } from '@playwright/test'
import {
  openArDialog,
  setupCameraTracking,
  setupMockApi,
  recordReportEntry,
} from './helpers'

test.describe('Interactive AR Camera Permission Denial', () => {
  test.beforeEach(async ({ page }) => {
    await setupCameraTracking(page)
  })

  // -------------------------------------------------------------------------
  // K2.4: Permission denial: no retry, shows clear message
  // -------------------------------------------------------------------------
  test('camera 4: permission denied does not retry and shows Vietnamese message', async ({ page }) => {
    await setupMockApi(page, 'tennis')
    await page.goto('/?e2e=1')
    await page.evaluate(() => {
      window.__gumCalls = 0
      window.__gumFailures = ['NotAllowedError']
    })
    await openArDialog(page, 'tennis')

    // Wait 2 seconds
    await page.waitForTimeout(2000)

    const calls = await page.evaluate(() => window.__gumCalls)
    // Exactly 1 call, NO retries
    expect(calls).toBe(1)

    // Check message in dialog
    const errorMsg = page.locator('dialog[open]').getByText('Bạn đã từ chối quyền camera. Vẫn chơi được ở chế độ nền ảo.')
    await expect(errorMsg).toBeVisible()

    // Game can still start and be played in virtual floor
    const startBtn = page.locator('dialog[open] button:has-text("Bắt đầu")')
    await expect(startBtn).toBeVisible()
    await startBtn.click()

    const snap = await page.evaluate(() => window.__SPORTSNAP_AR__?.())
    expect(snap?.phase).toBe('playing')

    await recordReportEntry({
      sport: 'tennis',
      scenario: 'K2.4 Permission denial does not retry',
      measured: { gumCalls: calls, messageShown: true },
      passed: calls === 1,
    })
  })
})
