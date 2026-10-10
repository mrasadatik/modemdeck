import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAuthRoutes } from '../src/interfaces/http/auth-routes.js';
import { osUnprotect } from '../src/infrastructure/crypto/vault.js';
import type { Repository } from '../src/domain/ports/repository.js';
import type { ModemDatabase } from '../src/domain/entities/types.js';

const emptyDb = (): ModemDatabase => ({
  sms: [],
  sent: [],
  calls: [],
  ussd: [],
  contacts: [],
  parts: {},
  seen: {},
});

function setup() {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'modemdeck-auth-'));
  const sent: Array<{ to: string; text: string }> = [];
  const repository = {
    state: emptyDb(),
    save: async () => {},
    replace: async () => {},
    unlock: () => {},
    lock: () => {},
  } as unknown as Repository<ModemDatabase>;
  const routes = createAuthRoutes({
    rootDir,
    repository,
    activeSimId: () => 'SIM1',
    sendSms: async (to: string, text: string) => {
      sent.push({ to, text });
      return 1;
    },
  });
  return {
    rootDir,
    sent,
    routes,
    cleanup: () => fs.rmSync(rootDir, { recursive: true, force: true }),
    otp: () => /(\d{6})/.exec(sent[sent.length - 1]?.text ?? '')?.[1] ?? '',
  };
}

const profile = { name: 'Tester', simLabel: 'lab', country: 'BD', password: 'pass1234' };

test('setup requires a recovery number', async () => {
  const t = setup();
  try {
    await assert.rejects(
      t.routes['POST /api/auth/setup']({ ...profile, recovery: '' }),
      /recovery number is required/,
    );
  } finally {
    t.cleanup();
  }
});

test('setup rejects an invalid recovery number', async () => {
  const t = setup();
  try {
    await assert.rejects(
      t.routes['POST /api/auth/setup']({ ...profile, recovery: '12' }),
      /invalid recovery number/,
    );
  } finally {
    t.cleanup();
  }
});

test('setup refuses without OTP proof', async () => {
  const t = setup();
  try {
    await t.routes['POST /api/auth/setup/request']({ recovery: '01712345678', country: 'BD' });
    assert.equal(t.sent.length, 1);
    assert.equal(t.sent[0].to, '+8801712345678');
    await assert.rejects(
      t.routes['POST /api/auth/setup']({ ...profile, recovery: '+8801712345678' }),
      /verify the recovery number first/,
    );
  } finally {
    t.cleanup();
  }
});

test('wrong OTP is rejected and locks after too many tries', async () => {
  const t = setup();
  try {
    await t.routes['POST /api/auth/setup/request']({ recovery: '01712345678', country: 'BD' });
    for (let attempt = 0; attempt < 5; attempt++)
      await assert.rejects(t.routes['POST /api/auth/setup/verify']({ otp: '000000' }), /wrong OTP/);
    await assert.rejects(
      t.routes['POST /api/auth/setup/verify']({ otp: '000000' }),
      /too many attempts/,
    );
  } finally {
    t.cleanup();
  }
});

test('verified OTP completes setup and stores canonical E.164', async () => {
  const t = setup();
  try {
    const requested = (await t.routes['POST /api/auth/setup/request']({
      recovery: '01712345678',
      country: 'BD',
    })) as { to: string };
    assert.match(requested.to, /\*+\d\d$/);
    const verified = (await t.routes['POST /api/auth/setup/verify']({ otp: t.otp() })) as {
      ok: boolean;
    };
    assert.equal(verified.ok, true);
    const created = (await t.routes['POST /api/auth/setup']({
      ...profile,
      recovery: '01712345678',
    })) as { profile: { name: string; simLabel: string } };
    assert.equal(created.profile.name, 'Tester');
    const status = (await t.routes['GET /api/auth/status']({})) as { configured: boolean };
    assert.equal(status.configured, true);
    const stored = JSON.parse(
      fs.readFileSync(path.join(t.rootDir, 'data', 'credentials.json'), 'utf8'),
    ) as { recovery?: string; recovery_os?: string; osVersion?: number };
    // DPAPI-wrapped on Windows, plaintext fallback elsewhere — either way E.164.
    const recovery =
      stored.osVersion === 3 && stored.recovery_os
        ? osUnprotect(stored.recovery_os)?.toString('utf8')
        : stored.recovery;
    assert.equal(recovery, '+8801712345678');
  } finally {
    t.cleanup();
  }
});

test('resending invalidates the previous OTP', async () => {
  const t = setup();
  try {
    await t.routes['POST /api/auth/setup/request']({ recovery: '01712345678', country: 'BD' });
    const first = t.otp();
    await t.routes['POST /api/auth/setup/request']({ recovery: '01712345678', country: 'BD' });
    await assert.rejects(t.routes['POST /api/auth/setup/verify']({ otp: first }), /wrong OTP/);
    const created = (await t.routes['POST /api/auth/setup/verify']({ otp: t.otp() })) as {
      ok: boolean;
    };
    assert.equal(created.ok, true);
  } finally {
    t.cleanup();
  }
});

test('setup verifies a changed number must be re-proven', async () => {
  const t = setup();
  try {
    await t.routes['POST /api/auth/setup/request']({ recovery: '01712345678', country: 'BD' });
    await t.routes['POST /api/auth/setup/verify']({ otp: t.otp() });
    await assert.rejects(
      t.routes['POST /api/auth/setup']({ ...profile, recovery: '+16502530000' }),
      /verify the recovery number first/,
    );
  } finally {
    t.cleanup();
  }
});
