import test from 'node:test';
import assert from 'node:assert/strict';
import { simScopedState } from '../src/application/sim-visibility.js';
import type { ModemDatabase } from '../src/domain/entities/types.js';
import type { LifecycleStatus } from '../src/infrastructure/modem/modem-lifecycle.js';

const status = (connected: boolean): LifecycleStatus => ({
  connected,
  port: 'COM3',
  error: '',
  capabilities: { sms: true },
});

const db = (): ModemDatabase => ({
  sms: [
    { id: 'a', from: '+1', ts: '', text: 'x', simId: 'sim-A' },
    { id: 'b', from: '+2', ts: '', text: 'y', simId: 'sim-B' },
  ],
  sent: [{ to: '+1', text: 'hi', ts: '', parts: 1, simId: 'sim-A' }],
  calls: [{ number: '+9', ts: '', simId: 'sim-B' }],
  ussd: [{ code: '*1#', text: 't', more: false, status: 0, ts: '', simId: 'sim-A' }],
  contacts: [],
  parts: {},
  seen: {},
});

test('sim visibility: disconnected SIM hides everything', () => {
  const out = simScopedState(db(), status(false), 'sim-A');
  assert.deepEqual(out.sms, []);
  assert.deepEqual(out.sent, []);
  assert.deepEqual(out.calls, []);
  assert.deepEqual(out.ussd, []);
});

test('sim visibility: connected SIM only sees its own records', () => {
  const out = simScopedState(db(), status(true), 'sim-A');
  assert.deepEqual(
    out.sms.map((m) => m.id),
    ['a'],
  );
  assert.deepEqual(
    out.sent.map((m) => m.to),
    ['+1'],
  );
  assert.deepEqual(out.calls, []);
  assert.deepEqual(
    out.ussd.map((u) => u.code),
    ['*1#'],
  );
});

test('sim visibility: unknown SIM identity hides everything', () => {
  const out = simScopedState(db(), status(true), '');
  assert.deepEqual(out.sms, []);
  assert.deepEqual(out.sent, []);
  assert.deepEqual(out.calls, []);
  assert.deepEqual(out.ussd, []);
});
