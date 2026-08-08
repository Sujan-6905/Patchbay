const STORAGE_KEY = 'patchbay.displayName';

export function getStoredDisplayName(): string {
  return localStorage.getItem(STORAGE_KEY) ?? '';
}

export function setStoredDisplayName(name: string): void {
  localStorage.setItem(STORAGE_KEY, name.trim());
}
