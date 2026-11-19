/**
 * Camera helpers and error classification for interactive AR games.
 *
 * Pure functions without DOM or React dependencies so they can be unit-tested.
 */

/**
 * Determines whether a camera acquisition failure is transient (device busy / locked
 * by another view such as the scanner) and should be retried once after a release delay.
 * Permanent failures such as permission denial or missing hardware must NEVER be retried
 * to prevent annoying the user with multiple permission dialogs.
 */
export function shouldRetryCamera(errorName: string): boolean {
  return errorName === 'NotReadableError' || errorName === 'AbortError'
}

/**
 * Maps MediaDevices / getUserMedia DOMExceptions to clear Vietnamese messages.
 */
export function cameraErrorMessage(errorName: string): string {
  if (errorName === 'NotAllowedError' || errorName === 'PermissionDeniedError') {
    return 'Bạn đã từ chối quyền camera. Vẫn chơi được ở chế độ nền ảo.'
  }
  if (errorName === 'NotFoundError' || errorName === 'DevicesNotFoundError') {
    return 'Không tìm thấy camera trên thiết bị.'
  }
  return 'Không mở được camera. Bạn vẫn chơi được ở chế độ nền ảo.'
}
