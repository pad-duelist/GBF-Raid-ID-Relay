import type { AppInput } from "@/domain/types";

const KEY = "gbf_calc_appinput_v1";

export function loadFromStorage(): AppInput | null {
  if (typeof window === "undefined") return null;
  try {
    const s = window.localStorage.getItem(KEY);
    if (!s) return null;
    return JSON.parse(s) as AppInput;
  } catch {
    return null;
  }
}

export function saveToStorage(v: AppInput): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify(v));
}

export function clearStorage(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(KEY);
}
