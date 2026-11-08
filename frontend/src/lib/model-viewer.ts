import { createViewerLoader } from './ar'

// Shared by the camera overlay and manual dialog; never called at page startup.
export const loadViewer = createViewerLoader(async () => {
  await import('@google/model-viewer')
  await customElements.whenDefined('model-viewer')
})
