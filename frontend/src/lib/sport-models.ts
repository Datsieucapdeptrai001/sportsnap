import type { ArAsset } from './ar'

/**
 * 3D model mapping: exact API/training label -> GLB file in `public/models/`.
 *
 * Covers the 20 classes in backend/models/labels.json. Files are the committed
 * generated GLBs listed in `public/models/manifest.json` (a test keeps the two in
 * sync). A label missing here uses `/models/<label>.glb`; any GLB that fails to
 * load at runtime falls back to the trophy, then the podium, so a 404 never breaks the page.
 */
export const SPORT_MODEL_FILES: Readonly<Record<string, string>> = {
  archery: '/models/archery.glb',
  baseball: '/models/baseball.glb',
  basketball: '/models/basketball.glb',
  boxing: '/models/boxing.glb',
  'canoe slamon': '/models/canoe_slamon.glb',
  'field hockey': '/models/field_hockey.glb',
  'figure skating women': '/models/figure_skating_women.glb',
  football: '/models/football.glb',
  'formula 1 racing': '/models/formula_1_racing.glb',
  golf: '/models/golf.glb',
  'high jump': '/models/high_jump.glb',
  hockey: '/models/hockey.glb',
  'olympic wrestling': '/models/olympic_wrestling.glb',
  polo: '/models/polo.glb',
  'roller derby': '/models/roller_derby.glb',
  'rollerblade racing': '/models/rollerblade_racing.glb',
  swimming: '/models/swimming.glb',
  tennis: '/models/tennis.glb',
  'uneven bars': '/models/uneven_bars.glb',
  volleyball: '/models/volleyball.glb',
}

/** Generic fallback when a sport GLB is missing or fails to load. */
export const TROPHY_MODEL_SRC = '/models/trophy.glb'
/** Last-resort committed fallback, used if the trophy GLB is missing too. */
export const FALLBACK_MODEL_SRC = '/fallback/podium.glb'

const MODEL_PATH = /^\/models\/[a-z0-9_]+\.glb$/

/** `/models/<label>.glb`, with spaces as underscores ("canoe slamon" -> canoe_slamon.glb). */
export function sportModelSrc(label: string): string {
  const slug = label.trim().toLowerCase().replace(/\s+/g, '_')
  return /^[a-z0-9_]+$/.test(slug) ? `/models/${slug}.glb` : TROPHY_MODEL_SRC
}

/** Next model to try after `src` failed to load: sport -> trophy -> podium -> none. */
export function nextFallbackSrc(src: string): string | null {
  const clean = src.split('?')[0]
  if (clean === FALLBACK_MODEL_SRC) return null
  if (clean === TROPHY_MODEL_SRC) return FALLBACK_MODEL_SRC
  return TROPHY_MODEL_SRC
}

/** Asset for any predicted label: the explicit map first, else the `/models/<label>.glb` convention. */
export function sportModelAsset(
  label: string,
  assets: Readonly<Partial<Record<string, ArAsset>>> = SPORT_MODEL_ASSETS,
): ArAsset {
  const asset = Object.hasOwn(assets, label) ? assets[label] : undefined
  return asset && MODEL_PATH.test(asset.glb) ? asset : { glb: sportModelSrc(label) }
}

export const SPORT_MODEL_ASSETS: Readonly<Record<string, ArAsset>> = Object.fromEntries(
  Object.entries(SPORT_MODEL_FILES).map(([label, glb]) => [label, { glb }]),
)

export type SportModelReason = 'idle' | 'mapped'

export interface SportModel {
  src: string
  isFallback: boolean
  arAllowed: boolean
  reason: SportModelReason
}

/** Any prediction shows its top-1 sport model, whatever the confidence. */
export function pickSportModel(
  result: { label: string } | null,
  assets: Readonly<Partial<Record<string, ArAsset>>> = SPORT_MODEL_ASSETS,
): SportModel {
  if (!result) return { src: TROPHY_MODEL_SRC, isFallback: true, arAllowed: false, reason: 'idle' }
  return { src: sportModelAsset(result.label, assets).glb, isFallback: false, arAllowed: true, reason: 'mapped' }
}
