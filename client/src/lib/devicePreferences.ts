const CAMERA_KEY = 'patchbay.cameraDeviceId';
const MIC_KEY = 'patchbay.micDeviceId';

export function getPreferredCameraId(): string | null {
  return localStorage.getItem(CAMERA_KEY);
}

export function setPreferredCameraId(deviceId: string): void {
  localStorage.setItem(CAMERA_KEY, deviceId);
}

export function getPreferredMicId(): string | null {
  return localStorage.getItem(MIC_KEY);
}

export function setPreferredMicId(deviceId: string): void {
  localStorage.setItem(MIC_KEY, deviceId);
}
