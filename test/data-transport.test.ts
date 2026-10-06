import test from 'node:test';
import assert from 'node:assert/strict';
import { DataTransportSelector } from '../src/application/data-transport-selector.js';
import { discoverWindowsDataTransports } from '../src/infrastructure/windows/data-transport-discovery.js';

test('data transport discovery detects RAS and excludes ordinary Wi-Fi', async () => {
  const run = async (file: string, args: string[]): Promise<{ ok: boolean; out: string }> => {
    const command = args.join(' ');
    if (command.includes('Win32_POTSModem'))
      return {
        ok: true,
        out: '[{"Name":"Qualcomm USB Modem 6000","AttachedTo":"COM4","Status":"OK"}]',
      };
    if (command.includes('Get-NetAdapter'))
      return {
        ok: true,
        out: '[{"Name":"Wireless","Status":"Up","InterfaceDescription":"Intel Wi-Fi","ifIndex":18},{"Name":"Mobile","Status":"Down","InterfaceDescription":"Qualcomm USB Network","ifIndex":50}]',
      };
    if (file === 'rasdial') return { ok: true, out: 'Connected to\\r\\nWireless Terminal\\r\\n' };
    return { ok: true, out: '[]' };
  };
  const candidates = await discoverWindowsDataTransports(run);
  assert.equal(
    candidates.some((item) => item.method === 'ras-ppp'),
    true,
  );
  assert.equal(
    candidates.some((item) => item.name === 'Wireless'),
    false,
  );
  assert.equal(
    candidates.some((item) => item.method === 'ndis'),
    true,
  );
});

test('selector prefers controllable RAS over detectable-only adapters', async () => {
  const selector = new DataTransportSelector(async () => [
    { method: 'mbim', control: 'detectable-only', name: 'WWAN', connected: true, evidence: [] },
    {
      method: 'ras-ppp',
      control: 'controllable',
      name: 'Wireless Terminal',
      connected: false,
      evidence: [],
    },
  ]);
  assert.equal((await selector.select())?.name, 'Wireless Terminal');
});
