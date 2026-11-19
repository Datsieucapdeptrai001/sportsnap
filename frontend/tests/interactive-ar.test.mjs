import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  BASKETBALL_LABEL, SPORT_GAMES, TARGET_Y, calculateBasketballVelocity, getSportGame, hasInteractiveGame, hasSportGame, highJumpBarHeight, interactiveTabLabel,
  isBasketballGoal, landingFromSwipe, markerPos, mashScore, mashSnapshot, shootPoints, streakBonus, targetX, timingGrade, timingPoints, zoneAfterStreak,
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

test('mash: running, won, lost by rival, lost by time', () => {
  assert.equal(mashSnapshot(10, 2, 40, 10, 4).state, 'running')
  assert.equal(mashSnapshot(40, 5, 40, 10, 4).state, 'won')
  assert.equal(mashSnapshot(20, 10, 40, 11, 4).state, 'lost') // rival finished at 10 s
  assert.equal(mashSnapshot(20, 10, 40, 10, 1).state, 'lost') // time ran out
  const won = mashSnapshot(40, 6, 40, 10, 2)
  assert.equal(mashScore(won), 100 + 40)
  assert.equal(mashScore(mashSnapshot(20, 10, 40, 10, 1)), 25)
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

test('basketball: physics calculations and goal detection', () => {
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
})
