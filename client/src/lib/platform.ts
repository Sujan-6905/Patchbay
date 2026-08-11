/** True on Android, where the OS speech-recognition service can't share the microphone with
 * an active getUserMedia capture, unlike desktop Chrome or iOS Safari. */
export function isAndroid(): boolean {
  return /Android/i.test(navigator.userAgent);
}
