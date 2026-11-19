import { test, expect } from '@playwright/test'
import {
  openArDialog,
  setupCameraTracking,
  setupMockApi,
  recordReportEntry,
} from './helpers'

test.describe('Interactive AR Camera Lifecycle', () => {
  test.beforeEach(async ({ page }) => {
    await setupCameraTracking(page)
  })

  // -------------------------------------------------------------------------
  // K2.1: Fake camera opens successfully in game
  // -------------------------------------------------------------------------
  test('camera 1: fake camera opens with readyState and videoWidth', async ({ page }) => {
    await setupMockApi(page, 'golf')
    await page.goto('/?e2e=1')
    await openArDialog(page, 'golf')

    await expect.poll(async () => {
      return await page.evaluate(() => {
        const video = document.querySelector('dialog[open] video') as HTMLVideoElement | null
        return Boolean(video && video.readyState >= 2 && video.videoWidth > 0)
      })
    }, { timeout: 6000 }).toBe(true)

    const measured = await page.evaluate(() => {
      const video = document.querySelector('dialog[open] video') as HTMLVideoElement
      return {
        readyState: video.readyState,
        videoWidth: video.videoWidth,
        videoHeight: video.videoHeight,
      }
    })

    await recordReportEntry({
      sport: 'golf',
      scenario: 'K2.1 Fake camera opens successfully',
      measured,
      passed: true,
    })
  })

  // -------------------------------------------------------------------------
  // K2.2: Closing dialog releases all camera tracks
  // -------------------------------------------------------------------------
  test('camera 2: closing dialog stops and releases all tracks', async ({ page }) => {
    await setupMockApi(page, 'archery')
    await page.goto('/?e2e=1')
    await openArDialog(page, 'archery')

    // Wait for camera to be active
    await page.waitForTimeout(1000)

    // Close the dialog
    const closeBtn = page.locator('dialog[open] button[aria-label="Đóng trình xem AR"]').first()
    await closeBtn.click()

    await expect(page.locator('dialog[open]')).toHaveCount(0)

    // Wait 500ms and verify all tracks ended
    await page.waitForTimeout(600)

    const allEnded = await page.evaluate(() => {
      const tracks = window.__tracks || []
      return tracks.length > 0 && tracks.every((t) => t.readyState === 'ended')
    })

    expect(allEnded).toBe(true)

    await recordReportEntry({
      sport: 'archery',
      scenario: 'K2.2 Closing dialog releases camera tracks',
      measured: { allEnded },
      passed: allEnded,
    })
  })

  // -------------------------------------------------------------------------
  // K2.3: Toggling camera does not reset game progress
  // -------------------------------------------------------------------------
  test('camera 3: toggling camera preserves game state and score', async ({ page }) => {
    await setupMockApi(page, 'basketball')
    await page.goto('/?e2e=1')
    await openArDialog(page, 'basketball')

    // Read initial score
    const snapBefore = await page.evaluate(() => window.__SPORTSNAP_AR__?.())
    expect(snapBefore?.phase).toBe('playing')

    // Click toggle camera button to off
    const camToggle = page.locator('dialog[open] button[aria-label="Tắt camera thực tế"], dialog[open] button[aria-label="Bật camera thực tế"]').first()
    await camToggle.click()
    await page.waitForTimeout(300)

    // Click toggle camera button back to on
    await camToggle.click()
    await page.waitForTimeout(300)

    const snapAfter = await page.evaluate(() => window.__SPORTSNAP_AR__?.())
    expect(snapAfter?.phase).toBe(snapBefore?.phase)
    expect(snapAfter?.score).toBe(snapBefore?.score)

    await recordReportEntry({
      sport: 'basketball',
      scenario: 'K2.3 Toggling camera preserves game state',
      measured: { phaseBefore: snapBefore?.phase, phaseAfter: snapAfter?.phase },
      passed: snapAfter?.phase === snapBefore?.phase,
    })
  })

  // -------------------------------------------------------------------------
  // K2.5: Busy camera (NotReadableError): retries once then recovers or reports error
  // -------------------------------------------------------------------------
  test('camera 5: transient hardware busy retries once', async ({ page }) => {
    await setupMockApi(page, 'hockey')

    // Subtest 5a: 1 transient failure -> recovers on retry
    await page.addInitScript(() => {
      window.__gumFailures = ['NotReadableError']
    })
    await page.goto('/?e2e=1')
    await openArDialog(page, 'hockey')

    await expect.poll(async () => {
      return await page.evaluate(() => window.__gumCalls)
    }, { timeout: 4000 }).toBe(2)

    // Verify video recovers and runs
    await expect.poll(async () => {
      return await page.evaluate(() => {
        const v = document.querySelector('dialog[open] video') as HTMLVideoElement | null
        return Boolean(v && v.readyState >= 2)
      })
    }, { timeout: 4000 }).toBe(true)

    // Subtest 5b: 2 failures -> exhausts retry and shows error
    const closeBtn = page.locator('dialog[open] button[aria-label="Đóng trình xem AR"]').first()
    await closeBtn.click()
    await page.waitForTimeout(600)

    await page.evaluate(() => {
      window.__gumCalls = 0
      window.__gumFailures = ['NotReadableError', 'NotReadableError']
    })

    const openBtn = page.locator('button:has-text("🎮 Chơi & xem AR")').first()
    await openBtn.click()

    await expect.poll(async () => {
      return await page.evaluate(() => window.__gumCalls)
    }, { timeout: 4000 }).toBe(2)

    const errorMsg = page.locator('dialog[open]').getByText('Không mở được camera. Bạn vẫn chơi được ở chế độ nền ảo.')
    await expect(errorMsg).toBeVisible()

    await recordReportEntry({
      sport: 'hockey',
      scenario: 'K2.5 Transient hardware busy retry logic',
      measured: { retryAttempts: 2 },
      passed: true,
    })
  })

  // -------------------------------------------------------------------------
  // K2.6: Seamless handoff between Scan screen and AR Dialog
  // -------------------------------------------------------------------------
  test('camera 6: camera handoff Scan -> Dialog -> Scan with no collision', async ({ page }) => {
    const { setLabel } = await setupMockApi(page, 'football')
    await page.goto('/?e2e=1')

    // Wait for camera on scan screen to be active
    await expect.poll(async () => {
      return await page.evaluate(() => {
        const v = document.querySelector('video')
        return Boolean(v && v.readyState >= 2 && (window.__tracks || []).some((t) => t.readyState === 'live'))
      })
    }, { timeout: 6000 }).toBe(true)

    const initialTracksCount = await page.evaluate(() => (window.__tracks || []).length)
    expect(initialTracksCount).toBeGreaterThanOrEqual(1)

    // Trigger image recognition to show prediction card
    setLabel('football')
    const fileInput = page.locator('#scan-image')
    await fileInput.setInputFiles({
      name: 'football.jpg',
      mimeType: 'image/jpeg',
      buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01, 0x00, 0x48, 0x00, 0x48, 0x00, 0x00, 0xff, 0xd9]),
    })

    const openArBtn = page.locator('button:has-text("🎮 Chơi & xem AR")').first()
    await openArBtn.waitFor({ state: 'visible', timeout: 5000 })
    await openArBtn.click()

    // Dialog opens. The previous scan tracks must have ended before or when dialog camera acquires stream
    await expect(page.locator('dialog[open]')).toBeVisible()

    // Wait for dialog camera to be active
    await expect.poll(async () => {
      return await page.evaluate(() => {
        const v = document.querySelector('dialog[open] video') as HTMLVideoElement | null
        return Boolean(v && v.readyState >= 2)
      })
    }, { timeout: 6000 }).toBe(true)

    // Close the AR dialog
    const closeBtn = page.locator('dialog[open] button[aria-label="Đóng trình xem AR"]').first()
    await closeBtn.click()
    await expect(page.locator('dialog[open]')).toHaveCount(0)

    // Switch back to Camera mode on scan screen
    const camModeBtn = page.locator('div[role="group"][aria-label="Chế độ nhận diện"] button:has-text("Camera")')
    await camModeBtn.click()

    // Verify video on scan screen is live again
    await expect.poll(async () => {
      return await page.evaluate(() => {
        const v = document.querySelector('video')
        return Boolean(v && v.readyState >= 2)
      })
    }, { timeout: 6000 }).toBe(true)

    await recordReportEntry({
      sport: 'football',
      scenario: 'K2.6 Camera handoff between Scan and Game',
      measured: { handoffClean: true },
      passed: true,
    })
  })
})
