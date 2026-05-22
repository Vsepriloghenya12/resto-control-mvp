type InstallMode = 'app' | 'bookings';

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

let deferredInstallPrompt: BeforeInstallPromptEvent | null = null;

function manifestHref(mode: InstallMode) {
  return mode === 'bookings' ? '/manifest-bookings.webmanifest' : '/manifest.webmanifest';
}

function setManifestMode(mode: InstallMode) {
  const link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
  if (link) link.href = manifestHref(mode);
}

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
}

export function configurePwaModeFromUrl() {
  const params = new URLSearchParams(window.location.search);
  setManifestMode(params.get('pwa') === 'bookings' ? 'bookings' : 'app');
}

export function registerPwaInstallPrompt() {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredInstallPrompt = event as BeforeInstallPromptEvent;
  });
  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
  });
}

export async function requestPwaInstall(mode: InstallMode) {
  setManifestMode(mode);

  const nextUrl = new URL(window.location.href);
  if (mode === 'bookings') {
    nextUrl.searchParams.set('tab', 'bookings');
    nextUrl.searchParams.set('pwa', 'bookings');
    window.history.replaceState(null, '', nextUrl);
  } else if (nextUrl.searchParams.has('pwa')) {
    nextUrl.searchParams.delete('pwa');
    window.history.replaceState(null, '', nextUrl);
  }

  if (!deferredInstallPrompt) {
    return {
      installed: false,
      message: isStandalone()
        ? 'Приложение уже установлено. Для плана зала откройте Брони в установленном приложении.'
        : 'Если окно установки не появилось, откройте меню браузера и выберите "Установить приложение" или "Добавить на главный экран".'
    };
  }

  const prompt = deferredInstallPrompt;
  deferredInstallPrompt = null;
  await prompt.prompt();
  const choice = await prompt.userChoice;
  return {
    installed: choice.outcome === 'accepted',
    message: choice.outcome === 'accepted' ? '' : 'Установка отменена'
  };
}

export function initialTabFromUrl(defaultTab: string, allowedTabs: string[]) {
  const tab = new URLSearchParams(window.location.search).get('tab') || '';
  return allowedTabs.includes(tab) ? tab : defaultTab;
}
