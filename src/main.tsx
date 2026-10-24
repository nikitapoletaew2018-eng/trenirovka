import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ensureSeed } from './data/seed';
import { isDemoMode } from './data/mode';
import { loadCycle } from './data/cycleRepo';
import { App } from './ui/App';
import { requestPersistence } from './ui/protect';
import { unlockAudio } from './ui/signals';
import './ui/styles.css';

// Звук таймера можно включить только после жеста пользователя.
window.addEventListener('pointerdown', unlockAudio, { once: true });

async function boot() {
  await ensureSeed();
  await loadCycle();
  // Постоянное хранилище нужно только реальным данным
  if (!isDemoMode()) void requestPersistence();
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void boot();
