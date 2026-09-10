import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthGate } from './AuthGate';
import { AppErrorBoundary } from './components/AppErrorBoundary';
import { initDisplayMode } from './lib/uiPrefs';
import './index.css';

initDisplayMode();

// تسجيل Service Worker بدون إعادة تحميل تلقائية — تفادي حلقة تحديث على بعض الأجهزة/الشبكات
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js?v=4').catch(() => {});
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <AuthGate />
    </AppErrorBoundary>
  </StrictMode>,
);
