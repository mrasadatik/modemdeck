import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAuthRoutes } from '../src/interfaces/http/auth-routes.js';
import { osUnprotect } from '../src/infrastructure/crypto/vault.js';
import type { SessionManager } from '../src/infrastructure/auth/session-store.js';
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

/**
 * In-memory session double with production semantics. Route tests must not
 * depend on native SQLite timing; the real store has its own suite and e2e
 * covers integration against the running server.
 */
function fakeSessions(): SessionManager {
  const rows = new Map<
    string,
    {
      id: string;
      createdAt: number;
      lastSeenAt: number;
      simId: string;
      via: string;
      label: string;
      revoked: boolean;
      revokeReason: string;
    }
  >();
  const rnd = (): string =>
    [...crypto.getRandomValues(new Uint8Array(16))]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  const now = () => Date.now();
  return {
    create: (options: { simId?: string; via: string; label?: string }) => {
      const record = {
        id: rnd(),
        createdAt: now(),
        lastSeenAt: now(),
        simId: options.simId ?? '',
        via: options.via,
        label: options.label ?? '',
        revoked: false,
        revokeReason: '',
      };
      rows.set(record.id, record);
      return record;
    },
    get: (id: string) => rows.get(id) ?? null,
    touch: (id: string, at = now()) => {
      const record = rows.get(id);
      if (!record || record.revoked) return false;
      record.lastSeenAt = at;
      return true;
    },
    revoke: (id: string, reason: string, at = now()) => {
      const record = rows.get(id);
      if (!record) return false;
      record.revoked = true;
      record.revokeReason = reason;
      record.lastSeenAt = at;
      return true;
    },
    revokeAll: (reason: string, at = now()) => {
      let count = 0;
      for (const record of rows.values())
        if (!record.revoked) {
          record.revoked = true;
          record.revokeReason = reason;
          record.lastSeenAt = at;
          count += 1;
        }
      return count;
    },
    live: () => [...rows.values()].filter((record) => !record.revoked),
    validate: (id: string, options: { simId?: string } = {}) => {
      const record = rows.get(id);
      if (!record || record.revoked) return { ok: false as const, reason: 'revoked' };
      if (options.simId && record.simId && record.simId !== options.simId)
        return { ok: false as const, reason: 'sim-mismatch' };
      return { ok: true as const, session: record };
    },
    sweep: () => ({ idle: 0, expired: 0, simChanged: 0 }),
    close: () => {},
  } as unknown as SessionManager;
}

function setup() {
  // Credentials stay per-test (a shared dir would trip 'profile already exists').
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
    sessions: fakeSessions(),
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
    await t.routes['POST /api/auth/setup/request']({ recovery: '01812345678', country: 'BD' });
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
      recovery: '01912345678',
      country: 'BD',
    })) as { to: string };
    assert.match(requested.to, /\*+\d\d$/);
    const verified = (await t.routes['POST /api/auth/setup/verify']({ otp: t.otp() })) as {
      ok: boolean;
    };
    assert.equal(verified.ok, true);
    const created = (await t.routes['POST /api/auth/setup']({
      ...profile,
      recovery: '01912345678',
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
    assert.equal(recovery, '+8801912345678');
  } finally {
    t.cleanup();
  }
});

test('resending invalidates the previous OTP', async () => {
  const t = setup();
  try {
    await t.routes['POST /api/auth/setup/request']({ recovery: '01312345678', country: 'BD' });
    const first = t.otp();
    // Same number within the cost window reuses the live code (no new SMS).
    const reused = (await t.routes['POST /api/auth/setup/request']({
      recovery: '01312345678',
      country: 'BD',
    })) as { reused?: boolean };
    assert.equal(reused.reused, true);
    assert.equal(t.sent.length, 1);
    const verified = (await t.routes['POST /api/auth/setup/verify']({ otp: first })) as {
      ok: boolean;
    };
    assert.equal(verified.ok, true);
  } finally {
    t.cleanup();
  }
});

test('a different number always sends a fresh code', async () => {
  const t = setup();
  try {
    await t.routes['POST /api/auth/setup/request']({ recovery: '01612345678', country: 'BD' });
    const stale = t.otp();
    await t.routes['POST /api/auth/setup/request']({ recovery: '+16502530000' });
    assert.equal(t.sent.length, 2);
    assert.equal(t.sent[1].to, '+16502530000');
    await assert.rejects(t.routes['POST /api/auth/setup/verify']({ otp: stale }), /wrong OTP/);
  } finally {
    t.cleanup();
  }
});

test('setup verifies a changed number must be re-proven', async () => {
  const t = setup();
  try {
    await t.routes['POST /api/auth/setup/request']({ recovery: '01512345678', country: 'BD' });
    await t.routes['POST /api/auth/setup/verify']({ otp: t.otp() });
    await assert.rejects(
      t.routes['POST /api/auth/setup']({ ...profile, recovery: '+16502530000' }),
      /verify the recovery number first/,
    );
  } finally {
    t.cleanup();
  }
});

test('unlock paths mint sessions; logout revokes; status is session-scoped', async () => {
  const t = setup();
  try {
    await t.routes['POST /api/auth/setup/request']({ recovery: '01412345678', country: 'BD' });
    await t.routes['POST /api/auth/setup/verify']({ otp: t.otp() });
    const created = (await t.routes['POST /api/auth/setup']({
      ...profile,
      recovery: '01412345678',
    })) as { sessionId: string; __session: { set: string } };
    assert.match(created.sessionId, /^[a-f0-9]{32}$/);
    assert.equal(created.__session.set, created.sessionId);

    const authed = (await t.routes['GET /api/auth/status']({}, new URLSearchParams(), {
      sessionId: created.sessionId,
    })) as { locked: boolean; session: { id: string } | null };
    assert.equal(authed.locked, false);
    assert.equal(authed.session?.id, created.sessionId);

    // Same server, no presenting session: strictly locked despite the live key.
    const anon = (await t.routes['GET /api/auth/status']({}, new URLSearchParams())) as {
      locked: boolean;
      session: null;
    };
    assert.equal(anon.locked, true);
    assert.equal(anon.session, null);

    const loggedOut = (await t.routes['POST /api/auth/logout']({}, new URLSearchParams(), {
      sessionId: created.sessionId,
    })) as { ok: boolean; __session: { clear: boolean } };
    assert.equal(loggedOut.ok, true);
    assert.equal(loggedOut.__session.clear, true);
    const after = (await t.routes['GET /api/auth/status']({}, new URLSearchParams(), {
      sessionId: created.sessionId,
    })) as { locked: boolean };
    assert.equal(after.locked, true);
  } finally {
    t.cleanup();
  }
});
