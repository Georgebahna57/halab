import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthGate } from './AuthGate';
import { AppErrorBoundary } from './components/AppErrorBoundary';
import { initDisplayMode } from './lib/uiPrefs';
import './index.css';

initDisplayMode();

// إزالة Service Worker القديم — كان يسبب حلقة تحديث وتسجيل خروج على شبكات بطيئة (سوريا)
if ('serviceWorker' in navigator) {
  void navigator.serviceWorker.getRegistrations().then(regs => {
    for (const reg of regs) void reg.unregister();
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <AuthGate />
    </AppErrorBoundary>
  </StrictMode>,
);
