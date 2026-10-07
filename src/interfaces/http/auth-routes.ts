import fs from 'node:fs';
import path from 'node:path';
import {
  deriveKey,
  decryptText,
  encryptText,
  verifyHash,
} from '../../infrastructure/crypto/vault.js';
import { unlockSession, lockSession, sessionKeyOrNull } from '../../bootstrap/session.js';
import type { Repository } from '../../domain/ports/repository.js';
import type { ModemDatabase } from '../../domain/entities/types.js';
import type { ApiBody } from './api-router.js';

const CRED_FILE = (root: string) => path.join(root, 'data', 'credentials.json');
const PROFILE_FILE = (root: string) => path.join(root, 'data', 'profile.json');
const RECOVERY_FILE = (root: string) => path.join(root, 'data', 'recovery.json');

const okPassword = (value: unknown): value is string =>
  typeof value === 'string' && value.length >= 4 && value.length <= 200;

/** Encrypted-at-rest onboarding, login, and lock control endpoints. */
export function createAuthRoutes({
  rootDir,
  repository,
  activeSimId,
  sendSms,
}: {
  rootDir: string;
  repository: Repository<ModemDatabase>;
  activeSimId: () => string;
  sendSms?: (to: string, text: string) => Promise<number>;
}): Record<string, (body: ApiBody) => Promise<unknown>> {
  return {
    'GET /api/auth/status': async () => {
      const locked = !sessionKeyOrNull();
      const configured = fs.existsSync(PROFILE_FILE(rootDir));
      let profile: unknown = null;
      if (!locked) {
        const raw = configured ? fs.readFileSync(PROFILE_FILE(rootDir), 'utf8') : null;
        const plain = raw ? decryptText(sessionKeyOrNull()!, raw) : null;
        if (plain) profile = JSON.parse(plain);
      }
      return { locked, configured, profile };
    },
    'POST /api/auth/setup': async (body) => {
      if (fs.existsSync(CRED_FILE(rootDir)))
        throw Object.assign(new Error('profile already exists'), { statusCode: 409 });
      const password = body.password;
      if (!okPassword(password))
        throw Object.assign(new Error('password must be 4–200 characters'), { statusCode: 400 });
      const name = typeof body.name === 'string' ? body.name.trim().slice(0, 120) : '';
      const gender = body.gender === 'male' || body.gender === 'female' ? body.gender : null;
      const simLabel = typeof body.simLabel === 'string' ? body.simLabel.trim().slice(0, 120) : '';
      const number = typeof body.number === 'string' ? body.number.trim().slice(0, 40) : '';
      const image =
        typeof body.image === 'string' && body.image.startsWith('data:image/')
          ? body.image.slice(0, 2_000_000)
          : '';
      if (!name || !gender || !simLabel)
        throw Object.assign(new Error('name, simLabel and gender are required'), {
          statusCode: 400,
        });
      const salt = (await import('node:crypto')).randomBytes(16);
      const key = deriveKey(password, salt);
      fs.mkdirSync(path.join(rootDir, 'data'), { recursive: true });
      fs.writeFileSync(
        CRED_FILE(rootDir),
        JSON.stringify({
          version: 1,
          simId: activeSimId() || '',
          recovery:
            typeof body.recovery === 'string'
              ? body.recovery.replace(/[^\d+]/g, '').slice(0, 20)
              : '',
          salt: salt.toString('base64'),
          verify: verifyHash(password, salt).toString('base64'),
        }),
        { mode: 0o600 },
      );
      fs.writeFileSync(
        PROFILE_FILE(rootDir),
        encryptText(
          key,
          JSON.stringify({ name, gender, simLabel, number, image, simId: activeSimId() || '' }),
        ),
        { mode: 0o600 },
      );
      unlockSession(key);
      repository.unlock?.(key);
      return { ok: true, profile: { name, gender, simLabel, number, image } };
    },
    'POST /api/auth/login': async (body) => {
      const password = body.password;
      if (!okPassword(password))
        throw Object.assign(new Error('invalid password'), { statusCode: 400 });
      if (!fs.existsSync(CRED_FILE(rootDir)))
        throw Object.assign(new Error('no profile configured'), { statusCode: 404 });
      const stored = JSON.parse(fs.readFileSync(CRED_FILE(rootDir), 'utf8')) as {
        salt: string;
        verify: string;
        version?: number;
        simId?: string;
      };
      const salt = Buffer.from(stored.salt, 'base64');
      const key = deriveKey(password, salt);
      if (
        Buffer.from(stored.verify, 'base64').toString('base64') !==
        verifyHash(password, salt).toString('base64')
      )
        throw Object.assign(new Error('wrong password'), { statusCode: 401 });
      if (stored.version === 1 && stored.simId && activeSimId() && stored.simId !== activeSimId())
        throw Object.assign(new Error('SIM mismatch: this profile belongs to a different SIM'), {
          statusCode: 403,
        });
      unlockSession(key);
      repository.unlock?.(key);
      return { ok: true };
    },
    'POST /api/auth/logout': async () => {
      lockSession();
      repository.lock?.();
      return { ok: true };
    },
    'POST /api/auth/recover/request': async () => {
      if (!fs.existsSync(CRED_FILE(rootDir)))
        throw Object.assign(new Error('no profile configured'), { statusCode: 404 });
      const stored = JSON.parse(fs.readFileSync(CRED_FILE(rootDir), 'utf8')) as {
        recovery?: string;
      };
      if (!stored.recovery || !sendSms)
        throw Object.assign(new Error('recovery number not configured'), { statusCode: 404 });
      const otp = String(Math.floor(100000 + Math.random() * 900000));
      fs.mkdirSync(path.join(rootDir, 'data'), { recursive: true });
      fs.writeFileSync(RECOVERY_FILE(rootDir), JSON.stringify({ otp, ts: Date.now(), tries: 0 }), {
        mode: 0o600,
      });
      await sendSms(stored.recovery, `ModemDeck recovery code: ${otp}. Expires in 10 minutes.`);
      return { ok: true, to: stored.recovery.replace(/\d(?=\d{2})/g, '*') };
    },
    'POST /api/auth/recover/verify': async (body) => {
      if (!fs.existsSync(CRED_FILE(rootDir)) || !fs.existsSync(RECOVERY_FILE(rootDir)))
        throw Object.assign(new Error('no recovery pending'), { statusCode: 404 });
      const rec = JSON.parse(fs.readFileSync(RECOVERY_FILE(rootDir), 'utf8')) as {
        otp: string;
        ts: number;
        tries: number;
      };
      const tries = (rec.tries || 0) + 1;
      const fresh = Date.now() - rec.ts < 10 * 60 * 1000;
      const newPassword = body.password;
      if (!fresh) throw Object.assign(new Error('OTP expired'), { statusCode: 410 });
      if (tries > 5) throw Object.assign(new Error('too many attempts'), { statusCode: 429 });
      if (!okPassword(newPassword))
        throw Object.assign(new Error('invalid new password'), { statusCode: 400 });
      const stored = JSON.parse(fs.readFileSync(CRED_FILE(rootDir), 'utf8')) as {
        simId?: string;
        recovery?: string;
      };
      if (String(body.otp || '') !== rec.otp) {
        fs.writeFileSync(RECOVERY_FILE(rootDir), JSON.stringify({ ...rec, tries }));
        throw Object.assign(new Error('wrong OTP'), { statusCode: 401 });
      }
      const salt = (await import('node:crypto')).randomBytes(16);
      const key = deriveKey(newPassword, salt);
      fs.writeFileSync(
        CRED_FILE(rootDir),
        JSON.stringify({
          version: 1,
          simId: stored.simId || '',
          recovery: stored.recovery || '',
          salt: salt.toString('base64'),
          verify: verifyHash(newPassword, salt).toString('base64'),
        }),
        { mode: 0o600 },
      );
      // Old encrypted rows are unrecoverable without the old key — wipe and re-init.
      dbClear(repository);
      repository.lock?.();
      lockSession();
      fs.rmSync(RECOVERY_FILE(rootDir), { force: true });
      unlockSession(key);
      repository.unlock?.(key);
      return {
        ok: true,
        wiped: true,
        note: 'new credential set; previously encrypted data is unrecoverable and has been removed',
      };
    },
  };
}

function dbClear(repository: Repository<ModemDatabase>): void {
  const state = repository.state;
  state.sms.length = 0;
  state.sent.length = 0;
  state.calls.length = 0;
  state.ussd.length = 0;
  for (const k of Object.keys(state.parts)) delete state.parts[k];
  for (const k of Object.keys(state.seen)) delete state.seen[k];
  void repository.replace(state);
}
