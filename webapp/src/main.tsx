import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { registerAppUpdateFlow } from './app-updates';
import './styles.css';

function lockMobileZoom() {
  let lastTouchEnd = 0;

  document.addEventListener('gesturestart', (event) => event.preventDefault(), { passive: false });
  document.addEventListener('touchend', (event) => {
    const now = Date.now();
    if (now - lastTouchEnd <= 300) event.preventDefault();
    lastTouchEnd = now;
  }, { passive: false });
}

lockMobileZoom();
registerAppUpdateFlow();

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
