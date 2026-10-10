import { writable } from 'svelte/store';
import { api } from './api';
import { status } from './store';
import type { Call, Sent, Sms, State, Status, Ussd } from './types';

const emptyState = (): State => ({
  status: { connected: false, port: '', error: '', capabilities: {} },
  sms: [],
  sent: [],
  calls: [],
  ussd: [],
});

/** Single live mirror of GET /api/state. Updated by SSE deltas and by
 *  optimistic local mutations — never by wholesale refetch storms. */
export const liveState = writable<State>(emptyState());
/** True while the SSE channel is (re)connected. */
export const sseLive = writable(false);

export interface CarrierInfo {
  operator: string;
  signalPct: number | null;
  registration: string;
}

/** Live carrier snapshot from the modem watcher; null until observed. */
export const carrierState = writable<CarrierInfo | null>(null);

export function applyCarrier(data: unknown): void {
  if (!isRecord(data)) return;
  const { operator, signalPct, registration } = data as {
    operator?: unknown;
    signalPct?: unknown;
    registration?: unknown;
  };
  if (typeof operator !== 'string' || typeof registration !== 'string') return;
  if (signalPct !== null && typeof signalPct !== 'number') return;
  carrierState.set({ operator, signalPct, registration });
}

const CAPS = { sms: 500, sent: 100, calls: 300, ussd: 50 } as const;

let loadToken = 0;
let loading = false;
let midLoadDelta = false;

function noteDelta(): void {
  if (loading) midLoadDelta = true;
}

/**
 * Full snapshot load with ordering protection: a superseded load is
 * dropped, and a load straddled by live deltas re-syncs once so the
 * snapshot can never clobber newer arrivals.
 */
export async function loadState(signal?: AbortSignal): Promise<void> {
  const token = ++loadToken;
  loading = true;
  try {
    const fresh = await api<State>('state', undefined, { signal });
    if (token !== loadToken) return;
    liveState.set(fresh);
    status.set(fresh.status);
    if (midLoadDelta) {
      midLoadDelta = false;
      await loadState(signal);
    }
  } finally {
    if (token === loadToken) loading = false;
  }
}

/** Reset for tests and lock-out. */
export function resetLiveState(): void {
  loadToken += 1;
  loading = false;
  midLoadDelta = false;
  liveState.set(emptyState());
  carrierState.set(null);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function applyStatus(next: unknown): void {
  if (!isRecord(next) || typeof next.connected !== 'boolean') return;
  const value = next as unknown as Status;
  liveState.update((state) => ({ ...state, status: value }));
  status.set(value);
}

export function applySms(message: unknown): void {
  if (!isRecord(message) || typeof message.id !== 'string') return;
  noteDelta();
  const sms = message as unknown as Sms;
  liveState.update((state) => ({
    ...state,
    sms: [sms, ...state.sms.filter((item) => item.id !== sms.id)].slice(0, CAPS.sms),
  }));
}

export function applyCall(record: unknown): void {
  if (!isRecord(record) || typeof record.number !== 'string') return;
  noteDelta();
  const call = record as unknown as Call;
  liveState.update((state) => ({
    ...state,
    calls: [
      call,
      ...state.calls.filter((item) => item.ts !== call.ts || item.number !== call.number),
    ].slice(0, CAPS.calls),
  }));
}

export function pushSent(message: Sent): void {
  liveState.update((state) => ({ ...state, sent: [message, ...state.sent].slice(0, CAPS.sent) }));
}

/** Confirm an optimistic send: swap the pending entry for the server copy. */
export function confirmSent(clientTs: string, entry: Sent): void {
  liveState.update((state) => ({
    ...state,
    sent: [entry, ...state.sent.filter((item) => item.ts !== clientTs)].slice(0, CAPS.sent),
  }));
}

export function removeSent(ts: string): void {
  liveState.update((state) => ({
    ...state,
    sent: state.sent.filter((item) => item.ts !== ts),
  }));
}

export function pushUssd(entry: Ussd): void {
  liveState.update((state) => ({ ...state, ussd: [entry, ...state.ussd].slice(0, CAPS.ussd) }));
}

export function removeSms(id: string): void {
  liveState.update((state) => ({ ...state, sms: state.sms.filter((item) => item.id !== id) }));
}
