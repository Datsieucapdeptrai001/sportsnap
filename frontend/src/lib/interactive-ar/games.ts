/**
 * Interactive AR mini-games for the 20 SportSnap classes.
 *
 * Pure data + pure functions (no DOM, no React) so the rules are unit-testable.
 * `basketball` keeps its dedicated Three.js game (components/ar/basketball-game.tsx);
 * the other 19 sports use the generic canvas engine (components/ar/sport-game.tsx)
 * driven by the config below. Three game modes:
 *   - shoot:  swipe up to throw/shoot a prop at a target (swipe speed = power, direction = aim)
 *   - timing: tap when a moving marker is inside the green zone
 *   - mash:   tap as fast as possible to beat a rival before time runs out
 */

export type GameMode = 'shoot' | 'timing' | 'mash'
export type TargetKind = 'goal' | 'uprights' | 'bullseye' | 'hole' | 'court'

export interface SportGameConfig {
  mode: GameMode
  /** Short Vietnamese game name, also used on the tab / button. */
  title: string
  /** One-line Vietnamese instruction. */
  hint: string
  /** Emoji icon for the tab and the HUD. */
  icon: string
  /** Emoji drawn as the thrown / hit / controlled object. */
  prop: string
  /** Emoji for the rival (mash mode only). */
  rivalIcon?: string
  /** CSS colour used for the fallback background (when the camera is off). */
  accent: string
  // shoot
  targetKind?: TargetKind
  /** Target half-width as a fraction of the canvas width. */
  targetRadius?: number
  /** Target sway speed in sweeps per second (0 = static). */
  targetSpeed?: number
  /** Score by distance from the centre (archery). */
  rings?: boolean
  // timing
  /** Initial green-zone width, 0..1 of the bar. */
  zone?: number
  /** Marker sweeps per second. */
  sweepSpeed?: number
  // mash
  /** Taps needed to win. */
  goal?: number
  /** Time limit in seconds. */
  seconds?: number
  /** Rival taps per second. */
  rival?: number
  /** Vietnamese labels for the two lanes. */
  lanes?: readonly [string, string]
}

export const SHOOT_ATTEMPTS = 8
export const TIMING_ATTEMPTS = 8
export const SHOOT_FLIGHT_MS = 650

export const SPORT_GAMES: Readonly<Record<string, SportGameConfig>> = {
  // ---- shoot (7) ----
  football: {
    mode: 'shoot', title: 'Sút bóng bầu dục', icon: '🏈', prop: '🏈', accent: '#14532d',
    hint: 'Vuốt lên để sút bóng qua khung chữ H', targetKind: 'uprights', targetRadius: 0.17, targetSpeed: 0,
  },
  golf: {
    mode: 'shoot', title: 'Đưa bóng vào lỗ', icon: '⛳', prop: '⚪', accent: '#166534',
    hint: 'Vuốt đủ lực và đúng hướng để bóng vào lỗ', targetKind: 'hole', targetRadius: 0.1, targetSpeed: 0,
  },
  hockey: {
    mode: 'shoot', title: 'Sút puck vào lưới', icon: '🏒', prop: '⚫', accent: '#0c4a6e',
    hint: 'Vuốt lên để sút – khung thành đang trượt ngang', targetKind: 'goal', targetRadius: 0.2, targetSpeed: 0.35,
  },
  'field hockey': {
    mode: 'shoot', title: 'Đánh bóng vào gôn', icon: '🏑', prop: '🟡', accent: '#14532d',
    hint: 'Vuốt lên để đánh bóng vào khung thành di động', targetKind: 'goal', targetRadius: 0.2, targetSpeed: 0.25,
  },
  archery: {
    mode: 'shoot', title: 'Bắn cung trúng đích', icon: '🏹', prop: '🏹', accent: '#7c2d12',
    hint: 'Vuốt lên để bắn – càng gần tâm càng nhiều điểm', targetKind: 'bullseye', targetRadius: 0.18, targetSpeed: 0.2, rings: true,
  },
  polo: {
    mode: 'shoot', title: 'Đánh bóng mã cầu', icon: '🐎', prop: '🔴', accent: '#365314',
    hint: 'Vuốt lên để đánh bóng qua cổng đang dịch chuyển', targetKind: 'goal', targetRadius: 0.2, targetSpeed: 0.4,
  },
  volleyball: {
    mode: 'shoot', title: 'Đập bóng chuyền', icon: '🏐', prop: '🏐', accent: '#1e3a8a',
    hint: 'Vuốt lên để đánh bóng qua lưới vào ô trống', targetKind: 'court', targetRadius: 0.2, targetSpeed: 0.3,
  },
  // ---- timing (5) ----
  baseball: {
    mode: 'timing', title: 'Vung gậy bóng chày', icon: '⚾', prop: '⚾', accent: '#7f1d1d',
    hint: 'Chạm khi quả bóng đi vào vùng xanh để vung gậy', zone: 0.24, sweepSpeed: 0.7,
  },
  tennis: {
    mode: 'timing', title: 'Đánh trả quần vợt', icon: '🎾', prop: '🎾', accent: '#365314',
    hint: 'Chạm đúng lúc để đánh trả quả bóng', zone: 0.22, sweepSpeed: 0.8,
  },
  'high jump': {
    mode: 'timing', title: 'Bật nhảy qua xà', icon: '🏃', prop: '🏃', accent: '#0f172a',
    hint: 'Chạm đúng nhịp để bật nhảy – xà cao dần', zone: 0.2, sweepSpeed: 0.75,
  },
  'uneven bars': {
    mode: 'timing', title: 'Buông tay trên xà', icon: '🤸', prop: '🤸', accent: '#4c1d95',
    hint: 'Chạm khi vận động viên lên đỉnh xà để buông tay', zone: 0.18, sweepSpeed: 0.9,
  },
  'figure skating women': {
    mode: 'timing', title: 'Hạ cánh cú xoay', icon: '⛸️', prop: '⛸️', accent: '#0e7490',
    hint: 'Chạm đúng nhịp để hạ cánh sau cú xoay', zone: 0.2, sweepSpeed: 0.85,
  },
  // ---- mash (7) ----
  swimming: {
    mode: 'mash', title: 'Đua bơi nước rút', icon: '🏊', prop: '🏊', rivalIcon: '🏊', accent: '#0369a1',
    hint: 'Chạm liên tục để bơi về đích trước đối thủ', goal: 45, seconds: 10, rival: 4.5, lanes: ['Bạn', 'Đối thủ'],
  },
  'canoe slamon': {
    mode: 'mash', title: 'Chèo thuyền về đích', icon: '🛶', prop: '🛶', rivalIcon: '🛶', accent: '#115e59',
    hint: 'Chạm liên tục để chèo nhanh hơn đối thủ', goal: 40, seconds: 10, rival: 3.8, lanes: ['Bạn', 'Đối thủ'],
  },
  'rollerblade racing': {
    mode: 'mash', title: 'Đua patin tốc độ', icon: '🛼', prop: '🛼', rivalIcon: '🛼', accent: '#9a3412',
    hint: 'Chạm liên tục để trượt về đích trước', goal: 45, seconds: 10, rival: 4.6, lanes: ['Bạn', 'Đối thủ'],
  },
  'roller derby': {
    mode: 'mash', title: 'Vượt rào đối kháng', icon: '🛼', prop: '🛼', rivalIcon: '🛡️', accent: '#831843',
    hint: 'Chạm liên tục để vượt qua hàng chặn', goal: 45, seconds: 10, rival: 4.2, lanes: ['Bạn', 'Hàng chặn'],
  },
  'formula 1 racing': {
    mode: 'mash', title: 'Đua xe Công thức 1', icon: '🏎️', prop: '🏎️', rivalIcon: '🏎️', accent: '#7f1d1d',
    hint: 'Chạm liên tục để tăng tốc về vạch đích', goal: 55, seconds: 10, rival: 5.2, lanes: ['Bạn', 'Đối thủ'],
  },
  'olympic wrestling': {
    mode: 'mash', title: 'Đẩy lùi đối thủ', icon: '🤼', prop: '🤼', rivalIcon: '🤼', accent: '#78350f',
    hint: 'Chạm liên tục để ghì và đẩy đối thủ ra khỏi thảm', goal: 40, seconds: 10, rival: 3.6, lanes: ['Sức bạn', 'Sức đối thủ'],
  },
  boxing: {
    mode: 'mash', title: 'Tung đòn hạ gục', icon: '🥊', prop: '🥊', rivalIcon: '🥊', accent: '#450a0a',
    hint: 'Chạm liên tục để tung đòn hạ gục đối thủ', goal: 35, seconds: 10, rival: 3.2, lanes: ['Đòn của bạn', 'Đòn đối thủ'],
  },
}

export const BASKETBALL_LABEL = 'basketball'

/** True for the 19 generic games (excludes the dedicated basketball game). */
export function hasSportGame(label: string): boolean {
  return Object.hasOwn(SPORT_GAMES, label)
}

/** True when any interactive game exists for the label (basketball included). */
export function hasInteractiveGame(label: string): boolean {
  return label === BASKETBALL_LABEL || hasSportGame(label)
}

export function getSportGame(label: string): SportGameConfig | null {
  return hasSportGame(label) ? SPORT_GAMES[label] : null
}

/** Label for the "interactive" tab / button. */
export function interactiveTabLabel(label: string): string {
  if (label === BASKETBALL_LABEL) return '🏀 Ném bóng rổ AR'
  const game = getSportGame(label)
  return game ? `${game.icon} ${game.title}` : ''
}

// ---------------------------------------------------------------- shoot mode

export interface Point { x: number; y: number }

const MIN_UPWARD_SWIPE_PX = 20

/**
 * Where a swipe lands on the target plane, in 0..1 canvas coordinates (y grows downward).
 * Direction picks the column, speed picks the depth (soft = short, hard = long).
 * Returns null for swipes that are not upward.
 */
export function landingFromSwipe(dx: number, dy: number, dtMs: number): Point | null {
  if (!(dy < -MIN_UPWARD_SWIPE_PX)) return null
  const dt = Math.max(dtMs, 40)
  const speed = Math.hypot(dx, dy) / dt // px per ms
  const lean = Math.max(-1, Math.min(1, dx / Math.abs(dy)))
  const power = Math.max(0, Math.min(1, (speed - 0.4) / 2))
  return { x: 0.5 + lean * 0.5, y: 0.9 - power * 0.8 }
}

/** Horizontal target centre (0..1) at time `tSec`. */
export function targetX(tSec: number, speed: number): number {
  return speed > 0 ? 0.5 + 0.28 * Math.sin(tSec * speed * Math.PI * 2) : 0.5
}

/** Fixed vertical centre of the target, 0..1 of canvas height. */
export const TARGET_Y = 0.3

/**
 * Points for a landing: 0 = miss. `aspect` is canvas width / height so the hit area is a
 * circle on screen. With `rings`, closer to the centre scores more (10 / 7 / 4).
 */
export function shootPoints(landing: Point, target: Point, radius: number, aspect: number, rings: boolean): number {
  const rx = radius
  const ry = radius * aspect
  const d = Math.hypot((landing.x - target.x) / rx, (landing.y - target.y) / ry)
  if (d > 1) return 0
  if (!rings) return 2
  return d <= 0.3 ? 10 : d <= 0.62 ? 7 : 4
}

/** Streak bonus: +1 point from the 3rd consecutive scoring shot/timing. */
export function streakBonus(streak: number): number {
  return streak >= 3 ? 1 : 0
}

// -------------------------------------------------------------- timing mode

/** Marker position 0..1 moving back and forth (triangle wave). */
export function markerPos(elapsedSec: number, sweepSpeed: number): number {
  const phase = (((elapsedSec * sweepSpeed) % 2) + 2) % 2
  return phase <= 1 ? phase : 2 - phase
}

/** Green zone shrinks 8% per consecutive success, never below 8% of the bar. */
export function zoneAfterStreak(baseZone: number, streak: number): number {
  return Math.max(0.08, baseZone * Math.pow(0.92, streak))
}

export type TimingGrade = 'perfect' | 'good' | 'miss'

export function timingGrade(pos: number, center: number, zone: number): TimingGrade {
  const d = Math.abs(pos - center)
  if (d <= zone * 0.2) return 'perfect'
  if (d <= zone / 2) return 'good'
  return 'miss'
}

export function timingPoints(grade: TimingGrade): number {
  return grade === 'perfect' ? 3 : grade === 'good' ? 1 : 0
}

// ---------------------------------------------------------------- mash mode

export type MashState = 'running' | 'won' | 'lost'

export interface MashSnapshot {
  state: MashState
  /** Player progress 0..1. */
  you: number
  /** Rival progress 0..1. */
  rival: number
  secondsLeft: number
}

export function mashSnapshot(taps: number, elapsedSec: number, goal: number, seconds: number, rivalPerSec: number): MashSnapshot {
  const you = Math.min(1, taps / goal)
  const rival = Math.min(1, (rivalPerSec * elapsedSec) / goal)
  const secondsLeft = Math.max(0, seconds - elapsedSec)
  let state: MashState = 'running'
  if (you >= 1) state = 'won'
  else if (rival >= 1 || secondsLeft <= 0) state = 'lost'
  return { state, you, rival, secondsLeft }
}

/** Final score for a won race: base 100 plus 10 per second left. Losing scores the progress made. */
export function mashScore(snapshot: MashSnapshot): number {
  return snapshot.state === 'won' ? 100 + Math.round(snapshot.secondsLeft * 10) : Math.round(snapshot.you * 50)
}
