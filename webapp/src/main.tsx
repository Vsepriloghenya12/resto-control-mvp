import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { registerAppUpdateFlow } from './app-updates';
import { configurePwaModeFromUrl, registerPwaInstallPrompt } from './pwa-install';
import './styles.css';

configurePwaModeFromUrl();
registerPwaInstallPrompt();
registerAppUpdateFlow();
document.documentElement.classList.add('dark');

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
