import { derived, writable } from 'svelte/store';
import type { Status } from './types';

export const activeView = writable('overview');
export const status = writable<Status>({ connected: false, port: '', error: '', capabilities: {} });
export const toast = writable('');
export type ToastKind = 'info' | 'ok' | 'error';
export const toastKind = writable<ToastKind>('info');
export const defaultCountry = writable('');

/** Number of in-flight api() requests; drives the global progress bar. */
export const busyCount = writable(0);
export const busy = derived(busyCount, ($count) => $count > 0);

/** True when the error is a user/system cancellation, not a failure. */
export function isAbort(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const name = (error as { name?: unknown }).name;
  if (name === 'AbortError') return true;
  const message = (error as { message?: unknown }).message;
  return typeof message === 'string' && /aborted|cancelled/i.test(message);
}

export interface AbortScope {
  /** A fresh tracked signal for one request. */
  signal(): AbortSignal;
  /** Cancel every tracked request (e.g. when a view unmounts). */
  abortAll(): void;
}

/** Tracks in-flight request controllers so nothing hangs past unmount. */
export function abortScope(): AbortScope {
  const controllers = new Set<AbortController>();
  return {
    signal: () => {
      const controller = new AbortController();
      controllers.add(controller);
      return controller.signal;
    },
    abortAll: () => {
      for (const controller of [...controllers]) {
        try {
          controller.abort();
        } catch {
          /* ignore */
        }
      }
      controllers.clear();
    },
  };
}

let timer: ReturnType<typeof setTimeout> | undefined;
export function notify(message: string, kind: ToastKind = 'info'): void {
  toast.set(message);
  toastKind.set(kind);
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    toast.set('');
    toastKind.set('info');
  }, 3800);
}
