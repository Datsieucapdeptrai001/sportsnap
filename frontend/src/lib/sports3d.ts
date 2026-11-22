import manifest from '../../public/models/manifest.json'
import { resolveSportModelKey } from './sport-models'

export interface Sport3DAssets {
  glb: string
  usdz?: string
}

export interface Sport3DMeta {
  file: string
  bytes: number
  triangles: number
  dimensions_m: readonly number[]
  scale?: string
}

// Exact training labels are recorded by the generator, including "canoe slamon".
// Quick Look generates USDZ from GLB when no explicit iOS asset is provided.
const candidates: Record<string, Sport3DAssets> = Object.fromEntries(
  Object.entries(manifest.models).map(([label, asset]) => [label, { glb: `/models/${asset.file}` }]),
)

const availableAssets = import.meta.glob('/public/models/*.glb', { query: '?url', import: 'default' })

const mappedEntries = Object.entries(candidates).filter(([, assets]) => `/public${assets.glb}` in availableAssets)
const mappedRecord: Record<string, Sport3DAssets> = Object.fromEntries(mappedEntries)
if (mappedRecord.football) {
  mappedRecord['american football'] = mappedRecord.football
}

export const sports3d: Readonly<Partial<Record<string, Sport3DAssets>>> = mappedRecord

export function getSport3DMeta(label: string): Sport3DMeta | null {
  const key = resolveSportModelKey(label)
  const models = manifest.models as Record<string, Sport3DMeta | undefined>
  return Object.hasOwn(models, key) ? (models[key] ?? null) : null
}

export function warnAboutUnmappedClasses(classes: string[]): void {
  if (!import.meta.env.DEV) return
  for (const label of Object.keys(candidates)) {
    if (!classes.includes(label)) console.warn(`3D mapping label is absent from /api/classes: ${label}`)
  }
}
