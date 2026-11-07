import type { ModelViewerElement } from '@google/model-viewer'
import type { DetailedHTMLProps, HTMLAttributes } from 'react'

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'model-viewer': DetailedHTMLProps<HTMLAttributes<ModelViewerElement>, ModelViewerElement> & {
        src: string
        alt: string
        ar?: boolean
        'ar-modes'?: string
        'ar-placement'?: 'floor' | 'wall'
        'ar-scale'?: 'auto' | 'fixed'
        'ios-src'?: string
        'camera-controls'?: boolean
        'auto-rotate'?: boolean
        'shadow-intensity'?: string
        'environment-image'?: string
        loading?: 'lazy' | 'eager'
      }
    }
  }
}
