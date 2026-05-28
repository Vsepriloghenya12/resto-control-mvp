import { api } from './api';

function urlBase64ToUint8Array(value: string) {
  const padding = '='.repeat((4 - value.length % 4) % 4);
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  const output = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) output[index] = raw.charCodeAt(index);
  return output;
}

function supportsPush() {
  return typeof window !== 'undefined'
    && 'serviceWorker' in navigator
    && 'PushManager' in window
    && 'Notification' in window;
}

export async function enablePushNotifications() {
  if (!supportsPush()) return 'Этот браузер не поддерживает push-уведомления для PWA';

  const settings = await api('/api/push/public-key');
  if (!settings.enabled || !settings.public_key) return 'Push-уведомления еще не настроены на сервере';

  let permission = Notification.permission;
  if (permission === 'default') permission = await Notification.requestPermission();
  if (permission !== 'granted') return 'Разрешение на уведомления не выдано';

  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  const subscription = existing || await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(settings.public_key)
  });

  await api('/api/push/subscriptions', { method: 'POST', body: JSON.stringify(subscription.toJSON()) });
  return 'Уведомления телефона включены';
}
