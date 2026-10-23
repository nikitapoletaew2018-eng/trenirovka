import { useSyncExternalStore } from 'react';

// Минимальный hash-роутер: работает из подпапки GitHub Pages и офлайн без настройки сервера.

function current(): string {
  const h = window.location.hash.replace(/^#/, '');
  return h === '' ? '/today' : h;
}

function subscribe(cb: () => void): () => void {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
}

export function useRoute(): string {
  return useSyncExternalStore(subscribe, current, current);
}

export function navigate(path: string): void {
  window.location.hash = path;
}

export function back(fallback = '/today'): void {
  if (window.history.length > 1) window.history.back();
  else navigate(fallback);
}

/** Сопоставление шаблона '/exercise/:id' с путём. */
export function match(pattern: string, path: string): Record<string, string> | null {
  const p = pattern.split('/');
  const a = path.split('?')[0]!.split('/');
  if (p.length !== a.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < p.length; i++) {
    const seg = p[i]!;
    const val = a[i]!;
    if (seg.startsWith(':')) params[seg.slice(1)] = decodeURIComponent(val);
    else if (seg !== val) return null;
  }
  return params;
}
