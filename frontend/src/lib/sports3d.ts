import manifest from '../../public/models/manifest.json'

export interface Sport3DAssets {
  glb: string
  usdz?: string
}

// Exact training labels are recorded by the generator, including "canoe slamon".
// Quick Look generates USDZ from GLB when no explicit iOS asset is provided.
const candidates: Record<string, Sport3DAssets> = Object.fromEntries(
  Object.entries(manifest.models).map(([label, asset]) => [label, { glb: `/models/${asset.file}` }]),
)

const availableAssets = import.meta.glob('/public/models/*.glb', { query: '?url', import: 'default' })

export const sports3d: Readonly<Partial<Record<string, Sport3DAssets>>> = Object.fromEntries(
  Object.entries(candidates).filter(([, assets]) => `/public${assets.glb}` in availableAssets),
)

export function warnAboutUnmappedClasses(classes: string[]): void {
  if (!import.meta.env.DEV) return
  for (const label of Object.keys(candidates)) {
    if (!classes.includes(label)) console.warn(`3D mapping label is absent from /api/classes: ${label}`)
  }
}
