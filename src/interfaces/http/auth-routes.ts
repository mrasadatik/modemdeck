import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  deriveKey,
  decryptText,
  encryptText,
  verifyHash,
  osProtect,
  osUnprotect,
} from '../../infrastructure/crypto/vault.js';
import { unlockSession, lockSession, sessionKeyOrNull } from '../../bootstrap/session.js';
import type { Repository } from '../../domain/ports/repository.js';
import type { ModemDatabase } from '../../domain/entities/types.js';
import type { ApiBody } from './api-router.js';

const CRED_FILE = (root: string) => path.join(root, 'data', 'credentials.json');
const PROFILE_FILE = (root: string) => path.join(root, 'data', 'profile.json');
/** In-memory-only pending OTP — never serialized to disk. */
const pendingOtp = new Map<string, { otp: string; ts: number; tries: number }>();

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
      const salt = randomBytes(16);
      const dataKey = randomBytes(32);
      const phrase = Array.from(randomBytes(16))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('-');
      const pwKey = deriveKey(password, salt);
      const osWrapped = osProtect(dataKey);
      fs.mkdirSync(path.join(rootDir, 'data'), { recursive: true });
      fs.writeFileSync(
        CRED_FILE(rootDir),
        JSON.stringify({
          version: 2,
          simId: activeSimId() || '',
          recovery:
            typeof body.recovery === 'string'
              ? body.recovery.replace(/[^\d+]/g, '').slice(0, 20)
              : '',
          salt: salt.toString('base64'),
          verify: verifyHash(password, salt).toString('base64'),
          wrapData: encryptText(pwKey, dataKey.toString('base64')),
          wrapPhrase: encryptText(deriveKey(phrase, salt), dataKey.toString('base64')),
          osProtected: osWrapped ?? '',
          osVersion: osWrapped ? 3 : 2,
        }),
        { mode: 0o600 },
      );
      fs.writeFileSync(
        PROFILE_FILE(rootDir),
        encryptText(
          dataKey,
          JSON.stringify({ name, gender, simLabel, number, image, simId: activeSimId() || '' }),
        ),
        { mode: 0o600 },
      );
      unlockSession(dataKey);
      repository.unlock?.(dataKey);
      return {
        ok: true,
        recoveryPhrase: phrase,
        profile: { name, gender, simLabel, number, image },
      };
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
        wrapData?: string;
        osProtected?: string;
        osVersion?: number;
      };
      const salt = Buffer.from(stored.salt, 'base64');
      const keyMaterial = deriveKey(password, salt);
      if (
        Buffer.from(stored.verify, 'base64').toString('base64') !==
        verifyHash(password, salt).toString('base64')
      )
        throw Object.assign(new Error('wrong password'), { statusCode: 401 });
      if (stored.version === 1 && stored.simId && activeSimId() && stored.simId !== activeSimId())
        throw Object.assign(new Error('SIM mismatch: this profile belongs to a different SIM'), {
          statusCode: 403,
        });
      let dataKey: Buffer = keyMaterial;
      if (stored.osVersion === 3 && stored.osProtected) {
        const unwrapped = osUnprotect(stored.osProtected);
        if (unwrapped) dataKey = unwrapped;
      } else if (stored.version === 2 && stored.wrapData) {
        const decoded = Buffer.from(decryptText(keyMaterial, stored.wrapData) ?? '', 'base64');
        if (decoded.length === 32) dataKey = decoded;
      }
      unlockSession(dataKey);
      repository.unlock?.(dataKey);
      return { ok: true };
    },
    'POST /api/auth/logout': async () => {
      lockSession();
      repository.lock?.();
      return { ok: true };
    },
    'POST /api/auth/recover/phrase': async (body) => {
      if (!fs.existsSync(CRED_FILE(rootDir)))
        throw Object.assign(new Error('no profile configured'), { statusCode: 404 });
      const stored = JSON.parse(fs.readFileSync(CRED_FILE(rootDir), 'utf8')) as {
        salt: string;
        version?: number;
        simId?: string;
        recovery?: string;
        wrapData?: string;
        wrapPhrase?: string;
        osProtected?: string;
        osVersion?: number;
      };
      if (!stored.wrapPhrase)
        throw Object.assign(new Error('recovery phrase not available for this profile'), {
          statusCode: 404,
        });
      const newPassword = body.password;
      const phrase = body.phrase;
      if (!okPassword(newPassword) || typeof phrase !== 'string' || !phrase.trim())
        throw Object.assign(new Error('phrase and new password required'), { statusCode: 400 });
      const salt = Buffer.from(stored.salt, 'base64');
      const plainWrapped = decryptText(deriveKey(phrase.trim(), salt), stored.wrapPhrase);
      if (!plainWrapped)
        throw Object.assign(new Error('wrong recovery phrase'), { statusCode: 401 });
      const dataKey = Buffer.from(plainWrapped, 'base64');
      const pwKey = deriveKey(newPassword, salt);
      fs.writeFileSync(
        CRED_FILE(rootDir),
        JSON.stringify({
          version: 2,
          simId: stored.simId || '',
          recovery: stored.recovery || '',
          salt: salt.toString('base64'),
          verify: verifyHash(newPassword, salt).toString('base64'),
          wrapData: encryptText(pwKey, dataKey.toString('base64')),
          wrapPhrase: stored.wrapPhrase,
          osProtected: stored.osProtected ?? '',
          osVersion: stored.osVersion ?? 2,
        }),
        { mode: 0o600 },
      );
      if (stored.simId && activeSimId() && stored.simId !== activeSimId())
        throw Object.assign(new Error('SIM mismatch'), { statusCode: 403 });
      // Session key is the data key — in-memory state restores without wiping history.
      unlockSession(dataKey);
      repository.unlock?.(dataKey);
      return { ok: true, preserved: true };
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
      pendingOtp.set('otp', { otp, ts: Date.now(), tries: 0 });
      await sendSms(stored.recovery, `ModemDeck recovery code: ${otp}. Expires in 10 minutes.`);
      return { ok: true, to: stored.recovery.replace(/\d(?=\d{2})/g, '*') };
    },
    'POST /api/auth/recover/verify': async (body) => {
      const stored = JSON.parse(fs.readFileSync(CRED_FILE(rootDir), 'utf8')) as {
        simId?: string;
        recovery?: string;
      };
      const rec = pendingOtp.get('otp');
      if (!rec || !fs.existsSync(CRED_FILE(rootDir)))
        throw Object.assign(new Error('no recovery pending'), { statusCode: 404 });
      const tries = (rec.tries || 0) + 1;
      const fresh = Date.now() - rec.ts < 10 * 60 * 1000;
      const newPassword = body.password;
      if (!fresh) throw Object.assign(new Error('OTP expired'), { statusCode: 410 });
      if (tries > 5) throw Object.assign(new Error('too many attempts'), { statusCode: 429 });
      if (!okPassword(newPassword))
        throw Object.assign(new Error('invalid new password'), { statusCode: 400 });
      if (String(body.otp || '') !== rec.otp) {
        pendingOtp.set('otp', { ...rec, tries });
        throw Object.assign(new Error('wrong OTP'), { statusCode: 401 });
      }
      const salt = randomBytes(16);
      const dataKey = randomBytes(32);
      const osWrapped = osProtect(dataKey);
      fs.writeFileSync(
        CRED_FILE(rootDir),
        JSON.stringify({
          version: 2,
          simId: stored.simId || '',
          recovery: stored.recovery || '',
          salt: salt.toString('base64'),
          verify: verifyHash(newPassword, salt).toString('base64'),
          wrapData: '',
          wrapPhrase: '',
          osProtected: osWrapped ?? '',
          osVersion: osWrapped ? 3 : 2,
        }),
        { mode: 0o600 },
      );
      dbClear(repository);
      repository.lock?.();
      lockSession();
      pendingOtp.delete('otp');
      unlockSession(dataKey);
      repository.unlock?.(dataKey);
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
