import { beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import {
  applyCall,
  applyCarrier,
  applySms,
  applyStatus,
  carrierState,
  confirmSent,
  loadState,
  pushSent,
  pushUssd,
  removeSent,
  removeSms,
  resetLiveState,
  liveState,
} from './live';

beforeEach(() => {
  vi.restoreAllMocks();
  resetLiveState();
});

describe('live deltas', () => {
  it('prepends SMS arrivals without duplicates and caps the list', () => {
    applySms({ id: 'a', from: '+1', text: 'hi', ts: 't1' });
    applySms({ id: 'a', from: '+1', text: 'hi', ts: 't1' });
    applySms({ id: 'b', from: '+2', text: 'yo', ts: 't2' });
    const sms = get(liveState).sms;
    expect(sms.map((item) => item.id)).toEqual(['b', 'a']);
    for (let index = 0; index < 600; index++)
      applySms({ id: `m${index}`, from: '+1', text: 'x', ts: `t${index}` });
    expect(get(liveState).sms.length).toBe(500);
    expect(get(liveState).sms[0].id).toBe('m599');
  });

  it('ignores malformed event payloads', () => {
    applySms(null);
    applySms({ noId: true });
    applyCall('junk');
    applyStatus({ connected: 'yes' });
    expect(get(liveState)).toEqual({
      status: { connected: false, port: '', error: '', capabilities: {} },
      sms: [],
      sent: [],
      calls: [],
      ussd: [],
    });
  });

  it('dedupes calls by timestamp and number', () => {
    applyCall({ number: '+1', ts: 't1' });
    applyCall({ number: '+1', ts: 't1' });
    applyCall({ number: '+2', ts: 't1' });
    expect(get(liveState).calls.length).toBe(2);
  });

  it('applies status payloads', () => {
    applyStatus({ connected: true, port: 'COM9', error: '' });
    expect(get(liveState).status.port).toBe('COM9');
  });
});

describe('optimistic mutations', () => {
  it('shows a pending send instantly, confirms, then rolls back on failure', () => {
    const draft = { to: '+1', text: 'hi', ts: 'c1', parts: 1, pending: true };
    pushSent(draft);
    expect(get(liveState).sent[0]).toEqual(draft);
    confirmSent('c1', { to: '+1', text: 'hi', ts: 's1', parts: 2 });
    expect(get(liveState).sent).toEqual([{ to: '+1', text: 'hi', ts: 's1', parts: 2 }]);
    pushSent({ to: '+1', text: 'x', ts: 'c2', parts: 1, pending: true });
    removeSent('c2');
    expect(get(liveState).sent.length).toBe(1);
  });

  it('tracks USSD history and archive removal', () => {
    pushUssd({ code: '*1#', text: 'ok', more: false, status: 0, ts: 't1' });
    expect(get(liveState).ussd.length).toBe(1);
    applySms({ id: 'gone', from: '+1', text: 'x', ts: 't' });
    removeSms('gone');
    expect(get(liveState).sms.length).toBe(0);
  });
});

describe('carrier snapshots', () => {
  it('applies well-formed carrier events and ignores junk', () => {
    applyCarrier({ operator: 'TestNet', signalPct: 65, registration: 'registered (home)' });
    expect(get(carrierState)).toEqual({
      operator: 'TestNet',
      signalPct: 65,
      registration: 'registered (home)',
    });
    applyCarrier(null);
    applyCarrier({ operator: 'X' });
    applyCarrier({ operator: 'Y', signalPct: 'high', registration: 'home' });
    expect(get(carrierState)?.operator).toBe('TestNet');
  });
});

describe('ordered loading', () => {
  it('drops superseded snapshots and resyncs across mid-load deltas', async () => {
    const resolvers: Array<(value: Response) => void> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            resolvers.push(resolve);
          }),
      ),
    );
    const live = { id: 'live', from: '+9', text: '!', ts: 't' };
    const snapshot = (port: string, sms: unknown[] = []) =>
      JSON.stringify({
        status: { connected: true, port, error: '', capabilities: {} },
        sms,
        sent: [],
        calls: [],
        ussd: [],
      });
    const first = loadState();
    const second = loadState();
    resolvers[0]?.(new Response(snapshot('COM1')));
    await first;
    // Superseded: COM1 must never surface.
    expect(get(liveState).status.port).toBe('');
    // A delta landing mid-load is covered by one converging resync whose
    // snapshot already contains the arrival.
    applySms(live);
    resolvers[1]?.(new Response(snapshot('COM2')));
    await new Promise((resolve) => setImmediate(resolve));
    resolvers[2]?.(new Response(snapshot('COM2', [live])));
    await second;
    expect(get(liveState).status.port).toBe('COM2');
    expect(get(liveState).sms.map((item) => item.id)).toContain('live');
  });
});
