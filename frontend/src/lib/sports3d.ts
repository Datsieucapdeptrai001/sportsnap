export interface Sport3DAssets {
  glb: string
  usdz: string
}

// Exact API labels; only enable a mapping when both team-supplied assets exist.
const candidates: Record<string, Sport3DAssets> = {
  football: { glb: '/models3d/football.glb', usdz: '/models3d/football.usdz' },
  basketball: { glb: '/models3d/basketball.glb', usdz: '/models3d/basketball.usdz' },
  golf: { glb: '/models3d/golf.glb', usdz: '/models3d/golf.usdz' },
}

const availableAssets = import.meta.glob('/public/models3d/*.{glb,usdz}', { query: '?url', import: 'default' })

export const sports3d: Readonly<Partial<Record<string, Sport3DAssets>>> = Object.fromEntries(
  Object.entries(candidates).filter(([, assets]) =>
    `/public${assets.glb}` in availableAssets && `/public${assets.usdz}` in availableAssets,
  ),
)

export function warnAboutUnmappedClasses(classes: string[]): void {
  if (!import.meta.env.DEV) return
  for (const label of Object.keys(candidates)) {
    if (!classes.includes(label)) console.warn(`3D mapping label is absent from /api/classes: ${label}`)
  }
}
