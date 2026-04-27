export type Session = {
  token: string;
  user: any;
  restaurant?: any;
};

const TOKEN_KEY = 'resto_token';
const OFFLINE_QUEUE_KEY = 'resto_offline_queue';
const OFFLINE_EVENT = 'resto-offline-queue-changed';

type OfflineOperation = {
  id: string;
  path: string;
  options: {
    method?: string;
    body?: BodyInit | null;
    headers?: Record<string, string>;
  };
  created_at: string;
};

function normalizeHeaders(headers?: HeadersInit) {
  return { 'Content-Type': 'application/json', ...((headers || {}) as Record<string, string>) };
}

function emitOfflineQueueChanged() {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(OFFLINE_EVENT));
}

function shouldQueueOffline(options: RequestInit = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  return !['GET', 'HEAD'].includes(method) && typeof options.body === 'string';
}

export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || '';
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

export function getOfflineQueue(): OfflineOperation[] {
  try {
    return JSON.parse(localStorage.getItem(OFFLINE_QUEUE_KEY) || '[]');
  } catch {
    return [];
  }
}

export function offlineQueueCount() {
  return getOfflineQueue().length;
}

function saveOfflineQueue(queue: OfflineOperation[]) {
  localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
  emitOfflineQueueChanged();
}

function queueOfflineMutation(path: string, options: RequestInit = {}) {
  const queue = getOfflineQueue();
  queue.push({
    id: `offline_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    path,
    options: { method: options.method || 'POST', body: options.body || null, headers: normalizeHeaders(options.headers) },
    created_at: new Date().toISOString()
  });
  saveOfflineQueue(queue);
}

async function rawFetch(path: string, options: RequestInit = {}) {
  const token = getToken();
  const headers: Record<string, string> = normalizeHeaders(options.headers);
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch(path, { ...options, headers });
}

export async function flushOfflineQueue() {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return { synced: 0, remaining: offlineQueueCount() };
  const queue = getOfflineQueue();
  let synced = 0;
  const remaining: OfflineOperation[] = [];

  for (const operation of queue) {
    try {
      const res = await rawFetch(operation.path, operation.options);
      if (!res.ok) {
        remaining.push(operation);
        continue;
      }
      synced += 1;
    } catch {
      remaining.push(operation);
      break;
    }
  }

  saveOfflineQueue(remaining);
  if (synced > 0) {
    try {
      await rawFetch('/api/offline/sync', { method: 'POST', body: JSON.stringify({ operations: queue.slice(0, synced).map(item => ({ id: item.id, path: item.path, created_at: item.created_at })) }) });
    } catch {
      // audit event is best-effort
    }
  }
  return { synced, remaining: remaining.length };
}

export async function api(path: string, options: RequestInit = {}) {
  try {
    const res = await rawFetch(path, options);
    const type = res.headers.get('content-type') || '';
    const data = type.includes('application/json') ? await res.json() : await res.text();
    if (!res.ok) {
      const message = typeof data === 'string' ? data : data.error || 'Ошибка запроса';
      throw new Error(message);
    }
    return data;
  } catch (error: any) {
    const networkProblem = error instanceof TypeError || error?.name === 'TypeError' || (typeof navigator !== 'undefined' && !navigator.onLine);
    if (networkProblem && shouldQueueOffline(options)) {
      queueOfflineMutation(path, options);
      return { offline: true, queued: true };
    }
    throw error;
  }
}

export async function download(path: string, filename: string) {
  const token = getToken();
  const res = await fetch(path, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) throw new Error('Не удалось скачать файл');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export { OFFLINE_EVENT };
