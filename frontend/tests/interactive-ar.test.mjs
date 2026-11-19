import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import test from 'node:test'
import { cameraErrorMessage, shouldRetryCamera } from '../src/lib/interactive-ar/camera.ts'
import {
  BASKETBALL_GRAVITY, BASKETBALL_LABEL, BASKETBALL_RIM, BASKETBALL_RIM_RADIUS, BASKETBALL_START, SPORT_GAMES, TARGET_Y,
  calculateBasketballVelocity, getSportGame, hasInteractiveGame, hasSportGame, highJumpBarHeight, interactiveTabLabel,
  isBasketballGoal, landingFromSwipe, markerPos, mashScore, mashSnapshot, shootPoints, simulateBasketballShot, streakBonus,
  targetX, timingGrade, timingPoints, zoneAfterStreak,
} from '../src/lib/interactive-ar/games.ts'
import { sportNamesVi } from '../src/lib/sport-names.ts'

const labels = JSON.parse(readFileSync(new URL('../../backend/models/labels.json', import.meta.url), 'utf8').replace(/^﻿/, ''))

test('every one of the 20 classes has an interactive game: basketball dedicated + 19 generic', () => {
  assert.equal(labels.length, 20)
  for (const label of labels) assert.ok(hasInteractiveGame(label), label)
  const generic = labels.filter((label) => label !== BASKETBALL_LABEL)
  assert.equal(generic.length, 19)
  assert.deepEqual(Object.keys(SPORT_GAMES).sort(), [...generic].sort())
  assert.equal(hasSportGame(BASKETBALL_LABEL), false)
  assert.equal(getSportGame(BASKETBALL_LABEL), null)
  assert.equal(hasInteractiveGame('not a sport'), false)
  assert.equal(hasSportGame('constructor'), false)
})

test('game configs are complete for their mode and use Vietnamese text', () => {
  const modes = { shoot: 0, timing: 0, mash: 0 }
  for (const [label, cfg] of Object.entries(SPORT_GAMES)) {
    modes[cfg.mode] += 1
    assert.ok(Object.hasOwn(sportNamesVi, label), label)
    assert.ok(cfg.title.length > 0 && cfg.hint.length > 0 && cfg.prop.length > 0 && cfg.icon.length > 0, label)
    if (cfg.mode === 'shoot') {
      assert.ok(cfg.targetKind && cfg.targetRadius > 0.05 && cfg.targetRadius <= 0.3, label)
      assert.ok(cfg.targetSpeed >= 0 && cfg.targetSpeed <= 0.6, label)
    }
    if (cfg.mode === 'timing') {
      assert.ok(cfg.zone >= 0.15 && cfg.zone <= 0.3 && cfg.sweepSpeed > 0, label)
    }
    if (cfg.mode === 'mash') {
      assert.ok(cfg.goal > 0 && cfg.seconds > 0 && cfg.rival > 0 && cfg.lanes?.length === 2, label)
      // A human can reasonably sustain ~6 taps/s, so the goal must be reachable in time.
      assert.ok(cfg.goal / cfg.seconds <= 6, `${label}: goal too high for the time limit`)
      // Rival finishes around the time limit (0.95..1.05 * goal) so the rival can actually win.
      const rivalWork = cfg.rival * cfg.seconds
      assert.ok(rivalWork >= 0.95 * cfg.goal && rivalWork <= 1.05 * cfg.goal, `${label}: rival work ${rivalWork} not in [0.95, 1.05] * goal (${cfg.goal})`)
    }
  }
  assert.deepEqual(modes, { shoot: 7, timing: 5, mash: 7 })
})

test('tab label names the game; basketball keeps its original wording', () => {
  assert.equal(interactiveTabLabel(BASKETBALL_LABEL), '🏀 Ném bóng rổ AR')
  assert.equal(interactiveTabLabel('archery'), '🏹 Bắn cung trúng đích')
  assert.equal(interactiveTabLabel('unknown'), '')
})

test('landingFromSwipe ignores non-upward swipes and maps speed to depth and lean to column', () => {
  assert.equal(landingFromSwipe(0, 10, 100), null)
  assert.equal(landingFromSwipe(0, -10, 100), null)
  const soft = landingFromSwipe(0, -100, 400)
  const hard = landingFromSwipe(0, -400, 100)
  assert.ok(soft.y > hard.y, 'harder swipe lands further up the screen')
  assert.equal(landingFromSwipe(0, -200, 100).x, 0.5)
  assert.ok(landingFromSwipe(-300, -100, 100).x < 0.5)
  assert.ok(landingFromSwipe(300, -100, 100).x > 0.5)
  for (const [dx, dy, dt] of [[9999, -30, 1], [-9999, -30, 1], [0, -5000, 1]]) {
    const l = landingFromSwipe(dx, dy, dt)
    assert.ok(l.x >= 0 && l.x <= 1 && l.y >= 0 && l.y <= 1)
  }
})

test('every shoot target is reachable with a normal swipe', () => {
  for (const [label, cfg] of Object.entries(SPORT_GAMES)) {
    if (cfg.mode !== 'shoot') continue
    // Straight swipe at ~1.9 px/ms lands at the target height; scan speeds for one that hits the static centre.
    let hit = false
    for (let speed = 0.4; speed <= 2.6; speed += 0.05) {
      const landing = landingFromSwipe(0, -speed * 100, 100)
      if (shootPoints(landing, { x: 0.5, y: TARGET_Y }, cfg.targetRadius, 0.7, cfg.rings) > 0) hit = true
    }
    assert.ok(hit, `${label}: no swipe speed reaches the target`)
  }
})

test('shootPoints: miss outside, flat 2 inside, rings 10/7/4 by distance', () => {
  const t = { x: 0.5, y: 0.3 }
  assert.equal(shootPoints({ x: 0.9, y: 0.3 }, t, 0.2, 0.6, false), 0)
  assert.equal(shootPoints({ x: 0.5, y: 0.9 }, t, 0.2, 0.6, false), 0)
  assert.equal(shootPoints({ x: 0.55, y: 0.3 }, t, 0.2, 0.6, false), 2)
  assert.equal(shootPoints({ x: 0.5, y: 0.3 }, t, 0.2, 0.6, true), 10)
  assert.equal(shootPoints({ x: 0.6, y: 0.3 }, t, 0.2, 0.6, true), 7)
  assert.equal(shootPoints({ x: 0.67, y: 0.3 }, t, 0.2, 0.6, true), 4)
})

test('targetX is centred when static and stays on screen when swaying', () => {
  assert.equal(targetX(3.2, 0), 0.5)
  for (let t = 0; t < 10; t += 0.1) {
    const x = targetX(t, 0.4)
    assert.ok(x >= 0.2 && x <= 0.8)
  }
})

test('streak bonus starts at the third consecutive success', () => {
  assert.deepEqual([0, 1, 2, 3, 6].map(streakBonus), [0, 0, 0, 1, 1])
})

test('markerPos is a triangle wave in 0..1', () => {
  assert.equal(markerPos(0, 1), 0)
  assert.equal(markerPos(1, 1), 1)
  assert.equal(markerPos(2, 1), 0)
  assert.equal(markerPos(0.5, 1), 0.5)
  assert.equal(markerPos(1.5, 1), 0.5)
  for (let t = -5; t < 20; t += 0.37) {
    const p = markerPos(t, 0.8)
    assert.ok(p >= 0 && p <= 1)
  }
})

test('zone shrinks per streak but never below 8%', () => {
  assert.equal(zoneAfterStreak(0.2, 0), 0.2)
  assert.ok(zoneAfterStreak(0.2, 3) < 0.2)
  assert.equal(zoneAfterStreak(0.2, 100), 0.08)
})

test('timing grades and points', () => {
  assert.equal(timingGrade(0.5, 0.5, 0.2), 'perfect')
  assert.equal(timingGrade(0.58, 0.5, 0.2), 'good')
  assert.equal(timingGrade(0.7, 0.5, 0.2), 'miss')
  assert.deepEqual(['perfect', 'good', 'miss'].map(timingPoints), [3, 1, 0])
})

test('mash: running, won, lost by rival, fair time expiration rule', () => {
  assert.equal(mashSnapshot(10, 2, 40, 10, 4).state, 'running')
  assert.equal(mashSnapshot(40, 5, 40, 10, 4).state, 'won')
  assert.equal(mashSnapshot(20, 10, 40, 11, 4).state, 'lost') // rival reached 100%
  // Time ran out: player ahead wins, rival ahead loses, tie goes to player
  assert.equal(mashSnapshot(30, 10, 40, 10, 2.5).state, 'won') // player 30/40 > rival 25/40
  assert.equal(mashSnapshot(15, 10, 40, 10, 2.5).state, 'lost') // player 15/40 < rival 25/40
  assert.equal(mashSnapshot(25, 10, 40, 10, 2.5).state, 'won') // tie 25/40 === 25/40
  const won = mashSnapshot(40, 6, 40, 10, 2)
  assert.equal(mashScore(won), 100 + 40)
  assert.equal(mashScore(mashSnapshot(15, 10, 40, 10, 2.5)), Math.round((15 / 40) * 50))
  // A tie on the same frame goes to the player.
  assert.equal(mashSnapshot(40, 10, 40, 10, 4).state, 'won')
})

test('the dialog wires the interactive tab to the game config and code-splits the games', () => {
  const dialog = readFileSync(new URL('../src/components/sport-ar-button.tsx', import.meta.url), 'utf8')
  assert.match(dialog, /hasInteractiveGame\(label\)/)
  assert.match(dialog, /lazy\(\(\) => import\('\.\/ar\/sport-game'\)/)
  assert.match(dialog, /lazy\(\(\) => import\('\.\/ar\/basketball-game'\)/)
  assert.doesNotMatch(dialog, /^import \{ BasketballGame \}/m)
})

test('high jump bar starts at 1.80 m and climbs 0.05 m per successful clearance', () => {
  assert.equal(highJumpBarHeight(0), 1.8)
  assert.equal(highJumpBarHeight(1), 1.85)
  assert.equal(highJumpBarHeight(2), 1.9)
  assert.equal(highJumpBarHeight(4), 2.0)
  assert.equal(highJumpBarHeight(-2), 1.8)
})

test('basketball: physics calculations, goal detection, and aim assist criteria', () => {
  assert.equal(calculateBasketballVelocity(0, 10, 100), null)
  assert.equal(calculateBasketballVelocity(0, -10, 100), null)
  const shoot = calculateBasketballVelocity(50, -200, 100)
  assert.ok(shoot)
  assert.ok(shoot.forward < 0)
  assert.ok(shoot.upward > 0)
  assert.ok(shoot.lateral > 0)

  const rimPos = { x: 0, y: 2.15, z: -2.28 }
  const rimRadius = 0.225
  assert.equal(isBasketballGoal({ x: 0, y: 2.15, z: -2.28 }, -2, rimPos, rimRadius), true)
  assert.equal(isBasketballGoal({ x: 0, y: 2.15, z: -2.28 }, 2, rimPos, rimRadius), false) // upward velocity is not a swish
  assert.equal(isBasketballGoal({ x: 1, y: 2.15, z: -2.28 }, -2, rimPos, rimRadius), false) // outside rim

  // Verify exported constants match expected values
  assert.deepEqual(BASKETBALL_START, { x: 0, y: 0.95, z: 2.1 })
  assert.deepEqual(BASKETBALL_RIM, { x: 0, y: 2.15, z: -2.28 })
  assert.equal(BASKETBALL_RIM_RADIUS, 0.225)
  assert.equal(BASKETBALL_GRAVITY, -9.8)

  // M3: scan s in [1.30, 2.10], step 0.01 (81 samples)
  let inRangeCount = 0
  let inRangeGoals = 0
  for (let s = 130; s <= 210; s++) {
    inRangeCount++
    const speed = s / 100
    const vel = calculateBasketballVelocity(0, -speed * 100, 100)
    const sim = simulateBasketballShot(vel)
    if (sim.goal) inRangeGoals++
  }
  const pct = inRangeGoals / inRangeCount
  assert.ok(pct >= 0.80, `Expected at least 80% goals in [1.30, 2.10], got ${(pct * 100).toFixed(1)}% (${inRangeGoals}/${inRangeCount})`)

  // s <= 0.90: no goals
  for (let s = 25; s <= 90; s++) {
    const speed = s / 100
    const vel = calculateBasketballVelocity(0, -speed * 100, 100)
    const sim = simulateBasketballShot(vel)
    assert.equal(sim.goal, false, `Expected no goal at s=${speed}`)
  }

  // s >= 2.80: no goals
  for (let s = 280; s <= 350; s++) {
    const speed = s / 100
    const vel = calculateBasketballVelocity(0, -speed * 100, 100)
    const sim = simulateBasketballShot(vel)
    assert.equal(sim.goal, false, `Expected no goal at s=${speed}`)
  }

  // Vuốt lệch: dx = ±0.15 * |dy| ở s = 1.7 vẫn ghi bàn; dx = ±0.60 * |dy| thì trượt
  const dy17 = -170 // s = 1.7 at dt = 100
  const velPos15 = calculateBasketballVelocity(0.15 * Math.abs(dy17), dy17, 100)
  const velNeg15 = calculateBasketballVelocity(-0.15 * Math.abs(dy17), dy17, 100)
  assert.equal(simulateBasketballShot(velPos15).goal, true, 'dx = +0.15 * |dy| at s=1.7 should score')
  assert.equal(simulateBasketballShot(velNeg15).goal, true, 'dx = -0.15 * |dy| at s=1.7 should score')

  const velPos60 = calculateBasketballVelocity(0.60 * Math.abs(dy17), dy17, 100)
  const velNeg60 = calculateBasketballVelocity(-0.60 * Math.abs(dy17), dy17, 100)
  assert.equal(simulateBasketballShot(velPos60).goal, false, 'dx = +0.60 * |dy| at s=1.7 should miss')
  assert.equal(simulateBasketballShot(velNeg60).goal, false, 'dx = -0.60 * |dy| at s=1.7 should miss')

  // Find exact scoring range for documentation
  const scoringSpeeds = []
  for (let s = 50; s <= 300; s++) {
    const speed = s / 100
    const vel = calculateBasketballVelocity(0, -speed * 100, 100)
    if (simulateBasketballShot(vel).goal) scoringSpeeds.push(speed)
  }
  const minSpeed = scoringSpeeds[0]
  const maxSpeed = scoringSpeeds[scoringSpeeds.length - 1]
  console.log(`[basketball aim assist] scoring range: ${minSpeed} to ${maxSpeed} px/ms (${scoringSpeeds.length} speeds)`)
  assert.ok(minSpeed <= 1.30 && maxSpeed >= 2.10)
})

test('camera retry decision: only transient hardware locking retries, permission denial does not', () => {
  // Transient failures: retry once
  assert.equal(shouldRetryCamera('NotReadableError'), true)
  assert.equal(shouldRetryCamera('AbortError'), true)

  // Permanent failures: never retry
  assert.equal(shouldRetryCamera('NotAllowedError'), false)
  assert.equal(shouldRetryCamera('PermissionDeniedError'), false)
  assert.equal(shouldRetryCamera('NotFoundError'), false)
  assert.equal(shouldRetryCamera('DevicesNotFoundError'), false)
  assert.equal(shouldRetryCamera('SecurityError'), false)
  assert.equal(shouldRetryCamera('OverconstrainedError'), false)
  assert.equal(shouldRetryCamera('TypeError'), false)
  assert.equal(shouldRetryCamera(''), false)
})

test('camera error messages: clear Vietnamese messages mapped to error types', () => {
  assert.equal(
    cameraErrorMessage('NotAllowedError'),
    'Bạn đã từ chối quyền camera. Vẫn chơi được ở chế độ nền ảo.',
  )
  assert.equal(
    cameraErrorMessage('PermissionDeniedError'),
    'Bạn đã từ chối quyền camera. Vẫn chơi được ở chế độ nền ảo.',
  )
  assert.equal(
    cameraErrorMessage('NotFoundError'),
    'Không tìm thấy camera trên thiết bị.',
  )
  assert.equal(
    cameraErrorMessage('DevicesNotFoundError'),
    'Không tìm thấy camera trên thiết bị.',
  )
  assert.equal(
    cameraErrorMessage('NotReadableError'),
    'Không mở được camera. Bạn vẫn chơi được ở chế độ nền ảo.',
  )
  assert.equal(
    cameraErrorMessage('OtherRandomError'),
    'Không mở được camera. Bạn vẫn chơi được ở chế độ nền ảo.',
  )
})

test('production build does not leak __SPORTSNAP_AR__ test hook into bundle', () => {
  const distDir = new URL('../dist/assets', import.meta.url)
  const files = readdirSync(distDir).filter((file) => file.endsWith('.js'))
  assert.ok(files.length > 0, 'dist assets exist')
  for (const file of files) {
    const content = readFileSync(new URL(`../dist/assets/${file}`, import.meta.url), 'utf8')
    assert.ok(!content.includes('__SPORTSNAP_AR__'), `Found __SPORTSNAP_AR__ in ${file}`)
  }
})

