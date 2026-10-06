import test from 'node:test';
import assert from 'node:assert/strict';
import { listWindowsModems } from '../src/infrastructure/windows/modem-provider.js';

test('Windows modem provider parses one or many modem records', async () => {
  const modems = await listWindowsModems(async () => ({
    ok: true,
    out: '[{"Name":"Qualcomm USB Modem 6000","AttachedTo":"COM4","Status":"OK"}]',
  }));
  assert.deepEqual(modems, [{ name: 'Qualcomm USB Modem 6000', attachedTo: 'COM4', status: 'OK' }]);
});

test('Windows modem provider reports malformed command output as no records', async () => {
  assert.deepEqual(await listWindowsModems(async () => ({ ok: true, out: 'not-json' })), []);
});
