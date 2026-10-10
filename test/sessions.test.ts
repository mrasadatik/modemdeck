import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SessionManager } from '../src/infrastructure/auth/session-store.js';

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modemdeck-sessions-'));
  const file = path.join(dir, 'sessions.sqlite');
  return {
    manager: new SessionManager(file),
    file,
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

test('sessions are created with unique ids and listed as live', () => {
  const t = setup();
  try {
    const first = t.manager.create({ simId: 'SIM1', via: 'login', label: '127.0.0.1' });
    const second = t.manager.create({ simId: 'SIM1', via: 'setup' });
    assert.notEqual(first.id, second.id);
    assert.match(first.id, /^[a-f0-9]{32}$/);
    assert.equal(t.manager.live().length, 2);
    assert.deepEqual(t.manager.get(first.id)?.via, 'login');
    assert.equal(t.manager.get('nope'), null);
    assert.equal(t.manager.get('x'.repeat(32)), null);
  } finally {
    t.manager.close();
    t.cleanup();
  }
});

test('touch refreshes activity and reports liveness', () => {
  const t = setup();
  try {
    const session = t.manager.create({ via: 'login' });
    assert.equal(t.manager.touch(session.id, session.createdAt + 1000), true);
    assert.equal(t.manager.get(session.id)?.lastSeenAt, session.createdAt + 1000);
    assert.equal(t.manager.touch('0'.repeat(32)), false);
    t.manager.revoke(session.id, 'logout');
    assert.equal(t.manager.touch(session.id), false);
  } finally {
    t.manager.close();
    t.cleanup();
  }
});

test('revoke and revokeAll record reasons', () => {
  const t = setup();
  try {
    const first = t.manager.create({ via: 'login' });
    t.manager.create({ via: 'login' });
    assert.equal(t.manager.revoke(first.id, 'logout'), true);
    assert.equal(t.manager.get(first.id)?.revokeReason, 'logout');
    assert.equal(t.manager.revokeAll('lock'), 1);
    assert.equal(t.manager.live().length, 0);
    assert.equal(t.manager.revokeAll('lock'), 0);
  } finally {
    t.manager.close();
    t.cleanup();
  }
});

test('validate enforces revocation, SIM binding, expiry and idleness', () => {
  const t = setup();
  try {
    const base = Date.now();
    const sim = t.manager.create({ simId: 'SIM1', via: 'login', now: base });
    assert.equal(t.manager.validate(sim.id, { simId: 'SIM1', now: base }).ok, true);
    const mismatch = t.manager.validate(sim.id, { simId: 'SIM2', now: base });
    assert.equal(mismatch.ok, false);
    if (!mismatch.ok) assert.equal(mismatch.reason, 'sim-mismatch');

    const old = t.manager.create({ via: 'login', now: base });
    const expired = t.manager.validate(old.id, {
      limits: { idleMs: 0, maxAgeMs: 60_000 },
      now: base + 61_000,
    });
    assert.equal(expired.ok, false);
    if (!expired.ok) assert.equal(expired.reason, 'expired');
    assert.equal(t.manager.get(old.id)?.revoked, true);

    const idle = t.manager.create({ via: 'login', now: base });
    const lapsed = t.manager.validate(idle.id, {
      limits: { idleMs: 60_000, maxAgeMs: 0 },
      now: base + 61_000,
    });
    assert.equal(lapsed.ok, false);
    if (!lapsed.ok) assert.equal(lapsed.reason, 'idle');

    const gone = t.manager.create({ via: 'login', now: base });
    t.manager.revoke(gone.id, 'logout', base);
    assert.equal(t.manager.validate(gone.id, { now: base }).ok, false);
  } finally {
    t.manager.close();
    t.cleanup();
  }
});

test('sweep revokes idle, expired and SIM-changed sessions', () => {
  const t = setup();
  try {
    const base = Date.now();
    t.manager.create({ simId: 'SIM1', via: 'login', now: base });
    t.manager.create({ simId: 'SIM2', via: 'login', now: base });
    t.manager.create({ simId: 'SIM1', via: 'login', now: base - 200_000 });
    const swept = t.manager.sweep({
      limits: { idleMs: 60_000, maxAgeMs: 100_000 },
      simId: 'SIM1',
      now: base + 61_000,
    });
    assert.deepEqual(swept, { idle: 1, expired: 1, simChanged: 1 });
    assert.equal(t.manager.live().length, 0);
  } finally {
    t.manager.close();
    t.cleanup();
  }
});

test('sessions persist across reopening the same file', () => {
  const t = setup();
  try {
    const created = t.manager.create({ simId: 'SIM9', via: 'setup' });
    t.manager.close();
    const reopened = new SessionManager(t.file);
    try {
      assert.equal(reopened.get(created.id)?.simId, 'SIM9');
      assert.equal(reopened.live().length, 1);
    } finally {
      reopened.close();
    }
  } finally {
    t.cleanup();
  }
});
