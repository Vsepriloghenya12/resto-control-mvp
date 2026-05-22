export type AppVersionInfo = {
  name?: string;
  version?: string;
  build?: string;
  commit?: string;
  branch?: string;
  built_at?: string;
};

export const APP_UPDATE_AVAILABLE_EVENT = 'resto-control:update-available';

const VERSION_URL = '/app-version.json';
const STORED_BUILD_KEY = 'resto-control:app-build';
const RELOADED_BUILD_KEY = 'resto-control:reloaded-build';
const CHECK_INTERVAL_MS = 5 * 60 * 1000;

let latestUpdate: AppVersionInfo | null = null;
let registration: ServiceWorkerRegistration | null = null;
let intervalId = 0;

function versionKey(info: AppVersionInfo | null) {
  return String(info?.build || info?.commit || info?.built_at || info?.version || '').trim();
}

async function fetchVersion() {
  try {
    const response = await fetch(`${VERSION_URL}?t=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) return null;
    return await response.json() as AppVersionInfo;
  } catch {
    return null;
  }
}

async function clearAppCaches() {
  if (!('caches' in window)) return;
  const keys = await caches.keys();
  await Promise.all(keys.filter((key) => key.startsWith('resto-control-')).map((key) => caches.delete(key)));
}

function notifyUpdate(info: AppVersionInfo) {
  latestUpdate = info;
  window.dispatchEvent(new CustomEvent(APP_UPDATE_AVAILABLE_EVENT, { detail: info }));
}

async function activateWaitingWorker() {
  const waitingWorker = registration?.waiting;
  if (waitingWorker) waitingWorker.postMessage({ type: 'SKIP_WAITING' });
  navigator.serviceWorker?.controller?.postMessage({ type: 'CLEAR_CACHES' });
}

export async function applyAppUpdateNow(info: AppVersionInfo | null = latestUpdate) {
  const nextKey = versionKey(info);
  if (nextKey) {
    sessionStorage.setItem(RELOADED_BUILD_KEY, nextKey);
    localStorage.setItem(STORED_BUILD_KEY, nextKey);
  }
  await clearAppCaches();
  await activateWaitingWorker();
  window.location.reload();
}

async function checkAppVersion(autoReload: boolean) {
  const info = await fetchVersion();
  const nextKey = versionKey(info);
  if (!info || !nextKey) return;

  const storedKey = localStorage.getItem(STORED_BUILD_KEY);
  const alreadyReloadedKey = sessionStorage.getItem(RELOADED_BUILD_KEY);
  if (!storedKey) {
    localStorage.setItem(STORED_BUILD_KEY, nextKey);
    return;
  }
  if (storedKey === nextKey) {
    if (alreadyReloadedKey === nextKey) sessionStorage.removeItem(RELOADED_BUILD_KEY);
    return;
  }
  if (alreadyReloadedKey === nextKey) {
    localStorage.setItem(STORED_BUILD_KEY, nextKey);
    sessionStorage.removeItem(RELOADED_BUILD_KEY);
    return;
  }

  if (autoReload) {
    await applyAppUpdateNow(info);
    return;
  }

  notifyUpdate(info);
}

async function registerWorker() {
  if (!('serviceWorker' in navigator)) return;

  try {
    registration = await navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' });
    await registration.update();

    if (registration.waiting) void checkAppVersion(false);

    registration.addEventListener('updatefound', () => {
      const worker = registration?.installing;
      if (!worker) return;
      worker.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) {
          void checkAppVersion(false);
        }
      });
    });
  } catch {
    registration = null;
  }
}

export function registerAppUpdateFlow() {
  if (typeof window === 'undefined') return;

  const setup = async () => {
    await registerWorker();
    await checkAppVersion(true);

    if (!intervalId) {
      intervalId = window.setInterval(() => void checkAppVersion(false), CHECK_INTERVAL_MS);
    }
  };

  if (document.readyState === 'complete') {
    void setup();
  } else {
    window.addEventListener('load', () => void setup(), { once: true });
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void checkAppVersion(false);
  });
  window.addEventListener('online', () => void checkAppVersion(false));
}
