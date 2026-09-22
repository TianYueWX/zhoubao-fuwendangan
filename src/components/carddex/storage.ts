import type { CarddexLocale, CarddexQueryState, PinnedPrint } from "./types";

const QUERY_KEY = "carddex:query:v1";
const PINS_KEY = "carddex:pins:v1";
const UI_KEY = "carddex:ui:v1";

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable */
  }
}

export function loadQuery(fallback: CarddexQueryState): CarddexQueryState {
  return { ...fallback, ...read<Partial<CarddexQueryState>>(QUERY_KEY, {}) };
}
export function saveQuery(value: CarddexQueryState): void {
  write(QUERY_KEY, value);
}
export function loadPins(): PinnedPrint[] {
  return read<PinnedPrint[]>(PINS_KEY, []);
}
export function savePins(value: PinnedPrint[]): void {
  write(PINS_KEY, value);
}

export interface CarddexUiState {
  locale: CarddexLocale;
  sidebarOpen: boolean;
  chipsOpen: boolean;
  sections: Record<string, boolean>;
}

export function loadUi(): CarddexUiState {
  return read<CarddexUiState>(UI_KEY, {
    locale: "zh",
    sidebarOpen: true,
    chipsOpen: true,
    sections: {},
  });
}
export function saveUi(value: CarddexUiState): void {
  write(UI_KEY, value);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function encodeSharedState(state: CarddexQueryState): string {
  return bytesToBase64(new TextEncoder().encode(JSON.stringify(state)));
}

export function decodeSharedState(value: string): CarddexQueryState | null {
  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes)) as CarddexQueryState;
  } catch {
    return null;
  }
}
