import { writable } from 'svelte/store';
import type { Status } from './types';

export const activeView = writable('overview');
export const status = writable<Status>({ connected: false, port: '', error: '', capabilities: {} });
export const toast = writable('');
export const defaultCountry = writable('');

let timer: ReturnType<typeof setTimeout> | undefined;
export function notify(message: string): void {
  toast.set(message);
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => toast.set(''), 3800);
}
