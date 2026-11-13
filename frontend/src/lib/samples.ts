// Sample photos copied unchanged from datasets/anh-ngoai (Wikimedia Commons;
// titles and URLs are recorded in datasets/anh-ngoai/sources.csv).
export interface SamplePhoto {
  id: string
  /** Short Vietnamese caption for the button; the model's answer is never assumed. */
  caption: string
  src: string
  credit: string
}

export const SAMPLE_PHOTOS: readonly SamplePhoto[] = [
  { id: 'basketball', caption: 'Bóng rổ', src: '/samples/basketball.jpg', credit: 'Wikimedia Commons: Chicago Bulls - New Jersey Nets match on March 28, 1991' },
  { id: 'formula-1', caption: 'Đua xe', src: '/samples/formula-1.jpg', credit: 'Wikimedia Commons: 2010 Malaysian GP opening lap' },
  { id: 'swimming', caption: 'Bơi lội', src: '/samples/swimming.jpg', credit: 'Wikimedia Commons: Aliena Start 50S WM 2017' },
  { id: 'golf', caption: 'Gôn', src: '/samples/golf.jpg', credit: 'Wikimedia Commons: DSC 7011 A golfer in mid-swing tees off' },
]

export const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const

export function isAcceptedImage(file: Pick<File, 'type' | 'name'>): boolean {
  if ((ACCEPTED_TYPES as readonly string[]).includes(file.type)) return true
  return !file.type && /\.(jpe?g|png|webp)$/i.test(file.name)
}
