import test from 'node:test';
import assert from 'node:assert/strict';
import { ModemLifecycle } from '../src/infrastructure/modem/modem-lifecycle.js';

test('modem lifecycle shutdown is idempotent before connection', async () => {
  const status = {
    connected: false,
    port: '',
    error: '',
    capabilities: {} as Record<string, boolean>,
  };
  const lifecycle = new ModemLifecycle(
    'COM_DOES_NOT_EXIST',
    115200,
    status,
    async () => undefined,
    async () => undefined,
  );
  await lifecycle.stop();
  await lifecycle.stop();
  assert.equal(status.connected, false);
});
