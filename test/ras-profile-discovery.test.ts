import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { discoverMatchingRasProfiles } from '../src/infrastructure/windows/ras-profile-discovery.js';

test('RAS profile discovery matches modem metadata without guessing profile names', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ras-profile-'));
  try {
    const file = path.join(root, 'Microsoft', 'Network', 'Connections', 'Pbk');
    await fs.mkdir(file, { recursive: true });
    await fs.writeFile(
      path.join(file, 'rasphone.pbk'),
      '[Wireless Terminal]\r\nDevice=Qualcomm USB Modem 6000\r\n[Other]\r\nDevice=Other Modem\r\n',
    );
    assert.deepEqual(
      await discoverMatchingRasProfiles({
        modemName: 'Qualcomm USB Modem 6000',
        userProfile: root,
        programData: path.join(root, 'missing'),
      }),
      ['Wireless Terminal'],
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
