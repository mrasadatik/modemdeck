import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  deriveKey,
  decryptText,
  encryptText,
  verifyHash,
  osProtect,
  osProtectBulk,
  osUnprotect,
} from '../../infrastructure/crypto/vault.js';
import { unlockSession, lockSession, sessionKeyOrNull } from '../../bootstrap/session.js';
import { normalizeToE164 } from '../../domain/services/phone-numbers.js';
import type { Repository } from '../../domain/ports/repository.js';
import type { ModemDatabase } from '../../domain/entities/types.js';
import type { ApiBody } from './api-router.js';

const CRED_FILE = (root: string) => path.join(root, 'data', 'credentials.json');
const PROFILE_FILE = (root: string) => path.join(root, 'data', 'profile.json');
/** In-memory-only pending OTP — never serialized to disk. */
const pendingOtp = new Map<string, { otp: string; ts: number; tries: number }>();
/** In-memory-only onboarding verification — never serialized to disk. */
let pendingSetup: { otp: string; to: string; ts: number; tries: number; verified: boolean } | null =
  null;
let failedLogins: number[] = [];

/** Testing-only escape hatch (no modem in CI): skips the setup OTP proof. */
const setupSkipVerify = (): boolean => process.env.MODEMDECK_SETUP_SKIP_VERIFY === '1';

const maskNumber = (value: string): string => value.replace(/\d(?=\d{2})/g, '*');
const mintOtp = (): string => String(Math.floor(100000 + Math.random() * 900000));

const okPassword = (value: unknown): value is string =>
  typeof value === 'string' && value.length >= 4 && value.length <= 200;

/** Server-wide default country used for phone-number validation & formatting; empty = no default (require E.164 in numbers). */
let currentCountry = '';
export const getDefaultCountry = (): string => currentCountry;
const setDefaultCountry = (country: unknown): void => {
  if (typeof country === 'string' && (country.length === 2 || country === ''))
    currentCountry = country.toUpperCase();
};

/** Decrypt the simId/recovery metadata if the file uses DPAPI-wrapped fields. */
function readMeta(stored: {
  osVersion?: number;
  recovery?: string;
  simId?: string;
  recovery_os?: string;
  simId_os?: string;
}): { recovery: string; simId: string } {
  if (stored.osVersion === 3) {
    return {
      recovery: stored.recovery_os
        ? (osUnprotect(stored.recovery_os)?.toString('utf8') ?? stored.recovery ?? '')
        : (stored.recovery ?? ''),
      simId: stored.simId_os
        ? (osUnprotect(stored.simId_os)?.toString('utf8') ?? stored.simId ?? '')
        : (stored.simId ?? ''),
    };
  }
  return { recovery: stored.recovery ?? '', simId: stored.simId ?? '' };
}

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
      const configured = fs.existsSync(CRED_FILE(rootDir));
      let profile: unknown = null;
      if (!locked) {
        const raw = configured ? fs.readFileSync(PROFILE_FILE(rootDir), 'utf8') : null;
        const plain = raw ? decryptText(sessionKeyOrNull()!, raw) : null;
        if (plain) profile = JSON.parse(plain);
      }
      return { locked, configured, profile };
    },
    'POST /api/auth/setup/request': async (body) => {
      if (fs.existsSync(CRED_FILE(rootDir)))
        throw Object.assign(new Error('profile already exists'), { statusCode: 409 });
      if (!sendSms)
        throw Object.assign(new Error('modem unavailable for verification'), { statusCode: 503 });
      const country =
        typeof body.country === 'string' && body.country.length === 2
          ? body.country.toUpperCase()
          : currentCountry;
      const raw =
        typeof body.recovery === 'string' ? body.recovery.trim().replace(/[^\d+]/g, '') : '';
      const to = raw ? normalizeToE164(raw, country || undefined) : null;
      if (!to) throw Object.assign(new Error('invalid recovery number'), { statusCode: 400 });
      const otp = mintOtp();
      await sendSms(to, `ModemDeck setup code: ${otp}. Expires in 10 minutes.`);
      pendingSetup = { otp, to, ts: Date.now(), tries: 0, verified: false };
      return { ok: true, to: maskNumber(to) };
    },
    'POST /api/auth/setup/verify': async (body) => {
      if (fs.existsSync(CRED_FILE(rootDir)))
        throw Object.assign(new Error('profile already exists'), { statusCode: 409 });
      const pending = pendingSetup;
      if (!pending) throw Object.assign(new Error('no verification pending'), { statusCode: 404 });
      const tries = (pending.tries || 0) + 1;
      if (Date.now() - pending.ts >= 10 * 60 * 1000) {
        pendingSetup = null;
        throw Object.assign(new Error('OTP expired'), { statusCode: 410 });
      }
      if (tries > 5) throw Object.assign(new Error('too many attempts'), { statusCode: 429 });
      if (String(body.otp || '') !== pending.otp) {
        pendingSetup = { ...pending, tries };
        throw Object.assign(new Error('wrong OTP'), { statusCode: 401 });
      }
      pendingSetup = { ...pending, tries, verified: true };
      return { ok: true, to: maskNumber(pending.to) };
    },
    'POST /api/auth/setup': async (body) => {
      if (fs.existsSync(CRED_FILE(rootDir)))
        throw Object.assign(new Error('profile already exists'), { statusCode: 409 });
      const password = body.password;
      if (!okPassword(password))
        throw Object.assign(new Error('password must be 4–200 characters'), { statusCode: 400 });
      const name = typeof body.name === 'string' ? body.name.trim().slice(0, 120) : '';
      const simLabel = typeof body.simLabel === 'string' ? body.simLabel.trim().slice(0, 120) : '';
      const country =
        typeof body.country === 'string' ? body.country.slice(0, 2).toUpperCase() : '';
      if (!name || !simLabel)
        throw Object.assign(new Error('name and simLabel are required'), {
          statusCode: 400,
        });
      const rawRecovery =
        typeof body.recovery === 'string' ? body.recovery.trim().replace(/[^\d+]/g, '') : '';
      // Strictly coupled and required: the recovery number must be a valid
      // libphonenumber-js number (parsed with the onboarding country),
      // stored canonically as E.164, and proven by OTP unless skipped for
      // automated testing (MODEMDECK_SETUP_SKIP_VERIFY).
      const recovery = rawRecovery
        ? (normalizeToE164(rawRecovery, country || undefined) ??
          (() => {
            throw Object.assign(new Error('invalid recovery number'), { statusCode: 400 });
          })())
        : '';
      if (!recovery)
        throw Object.assign(new Error('recovery number is required'), { statusCode: 400 });
      if (!setupSkipVerify()) {
        const proof = pendingSetup;
        if (!proof?.verified || proof.to !== recovery) {
          throw Object.assign(new Error('verify the recovery number first'), {
            statusCode: 403,
          });
        }
        pendingSetup = null;
      }
      const salt = randomBytes(16);
      const dataKey = randomBytes(32);
      const phrase = Array.from(randomBytes(16))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('-');
      const pwKey = deriveKey(password, salt);
      const [osWrapped, osRecoveryEnc, osSimIdEnc] = osProtectBulk([
        dataKey,
        Buffer.from(recovery, 'utf8'),
        Buffer.from(activeSimId() || '', 'utf8'),
      ]);
      fs.mkdirSync(path.join(rootDir, 'data'), { recursive: true });
      fs.writeFileSync(
        CRED_FILE(rootDir),
        JSON.stringify({
          version: 2,
          simId: osWrapped ? '' : activeSimId() || '',
          recovery: osWrapped ? '' : recovery,
          salt: salt.toString('base64'),
          verify: verifyHash(password, salt).toString('base64'),
          wrapData: encryptText(pwKey, dataKey.toString('base64')),
          wrapPhrase: encryptText(deriveKey(phrase, salt), dataKey.toString('base64')),
          osProtected: osWrapped ?? '',
          osVersion: osWrapped ? 3 : 2,
          ...(osWrapped
            ? {
                recovery_os: osRecoveryEnc ?? '',
                simId_os: osSimIdEnc ?? '',
              }
            : {
                recovery,
                simId: activeSimId() || '',
              }),
        }),
        { mode: 0o600 },
      );
      fs.writeFileSync(
        PROFILE_FILE(rootDir),
        encryptText(
          dataKey,
          JSON.stringify({
            name,
            simLabel,
            country,
            simId: activeSimId() || '',
          }),
        ),
        { mode: 0o600 },
      );
      setDefaultCountry(country);
      unlockSession(dataKey);
      repository.unlock?.(dataKey);
      return {
        ok: true,
        recoveryPhrase: phrase,
        profile: { name, simLabel },
      };
    },
    'POST /api/auth/login': async (body) => {
      const password = body.password;
      if (!okPassword(password))
        throw Object.assign(new Error('invalid password'), { statusCode: 400 });
      const now = Date.now();
      failedLogins = failedLogins.filter((t) => now - t < 15 * 60_000);
      if (failedLogins.length >= 5)
        throw Object.assign(new Error('too many login attempts, wait 15 minutes'), {
          statusCode: 429,
        });
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
        simId_os?: string;
        recovery_os?: string;
      };
      const salt = Buffer.from(stored.salt, 'base64');
      const keyMaterial = deriveKey(password, salt);
      if (
        Buffer.from(stored.verify, 'base64').toString('base64') !==
        verifyHash(password, salt).toString('base64')
      ) {
        failedLogins.push(now);
        throw Object.assign(new Error('wrong password'), { statusCode: 401 });
      }
      failedLogins = [];
      const meta = readMeta(stored);
      if (meta.simId && activeSimId() && meta.simId !== activeSimId())
        throw Object.assign(new Error('SIM mismatch: this profile belongs to a different SIM'), {
          statusCode: 403,
        });
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
      try {
        if (fs.existsSync(PROFILE_FILE(rootDir))) {
          const prof = decryptText(dataKey, fs.readFileSync(PROFILE_FILE(rootDir), 'utf8'));
          if (prof) {
            const p = JSON.parse(prof) as { country?: string };
            if (p.country) setDefaultCountry(p.country);
          }
        }
      } catch {
        /* ignore */
      }
      return { ok: true };
    },
    'POST /api/auth/profile': async (body) => {
      if (!sessionKeyOrNull()) throw Object.assign(new Error('locked'), { statusCode: 423 });
      try {
        const raw = fs.existsSync(PROFILE_FILE(rootDir))
          ? fs.readFileSync(PROFILE_FILE(rootDir), 'utf8')
          : null;
        const current = JSON.parse(
          raw ? (decryptText(sessionKeyOrNull()!, raw) ?? '{}') : '{}',
        ) as Record<string, unknown>;
        const next = {
          name:
            typeof body.name === 'string' && body.name.trim()
              ? body.name.trim().slice(0, 120)
              : (current.name ?? ''),
          simLabel:
            typeof body.simLabel === 'string' && body.simLabel.trim()
              ? body.simLabel.trim().slice(0, 120)
              : (current.simLabel ?? ''),
          country:
            typeof body.country === 'string'
              ? body.country.length === 2
                ? body.country.toUpperCase()
                : ''
              : (current.country ?? ''),
          simId: current.simId ?? '',
        } as Record<string, unknown>;
        fs.writeFileSync(
          PROFILE_FILE(rootDir),
          encryptText(sessionKeyOrNull()!, JSON.stringify(next)),
        );
        setDefaultCountry(next.country);
        return { ok: true, profile: next };
      } catch (reason) {
        throw Object.assign(new Error('profile update failed'), { cause: reason });
      }
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
        simId_os?: string;
        recovery_os?: string;
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
          simId: readMeta(stored).simId,
          recovery: readMeta(stored).recovery,
          salt: salt.toString('base64'),
          verify: verifyHash(newPassword, salt).toString('base64'),
          wrapData: encryptText(pwKey, dataKey.toString('base64')),
          wrapPhrase: stored.wrapPhrase,
          osProtected: stored.osProtected ?? '',
          osVersion: stored.osVersion ?? 2,
          ...(stored.osVersion === 3
            ? { simId_os: stored.simId_os ?? '', recovery_os: stored.recovery_os ?? '' }
            : {}),
        }),
        { mode: 0o600 },
      );
      if (stored.simId && activeSimId() && stored.simId !== activeSimId())
        throw Object.assign(new Error('SIM mismatch'), { statusCode: 403 });
      // Session key is the data key — in-memory state restores without wiping history.
      unlockSession(dataKey);
      repository.unlock?.(dataKey);
      try {
        if (fs.existsSync(PROFILE_FILE(rootDir))) {
          const prof = decryptText(dataKey, fs.readFileSync(PROFILE_FILE(rootDir), 'utf8'));
          if (prof) {
            const p = JSON.parse(prof) as { country?: string };
            if (p.country) setDefaultCountry(p.country);
          }
        }
      } catch {
        /* ignore */
      }
      return { ok: true, preserved: true };
    },
    'POST /api/auth/recover/request': async () => {
      if (!fs.existsSync(CRED_FILE(rootDir)))
        throw Object.assign(new Error('no profile configured'), { statusCode: 404 });
      const stored = JSON.parse(fs.readFileSync(CRED_FILE(rootDir), 'utf8')) as {
        recovery?: string;
        osVersion?: number;
        recovery_os?: string;
      };
      const rec = readMeta(stored);
      if (!rec.recovery || !sendSms)
        throw Object.assign(new Error('recovery number not configured'), { statusCode: 404 });
      const otp = String(Math.floor(100000 + Math.random() * 900000));
      pendingOtp.set('otp', { otp, ts: Date.now(), tries: 0 });
      await sendSms(rec.recovery, `ModemDeck recovery code: ${otp}. Expires in 10 minutes.`);
      return { ok: true, to: rec.recovery.replace(/\d(?=\d{2})/g, '*') };
    },
    'POST /api/auth/recover/verify': async (body) => {
      const stored = JSON.parse(fs.readFileSync(CRED_FILE(rootDir), 'utf8')) as {
        simId?: string;
        recovery?: string;
        osVersion?: number;
        simId_os?: string;
        recovery_os?: string;
      };
      const rec = readMeta(stored);
      const recObj = pendingOtp.get('otp');
      if (!recObj || !fs.existsSync(CRED_FILE(rootDir)))
        throw Object.assign(new Error('no recovery pending'), { statusCode: 404 });
      const tries = (recObj.tries || 0) + 1;
      const fresh = Date.now() - recObj.ts < 10 * 60 * 1000;
      const newPassword = body.password;
      if (!fresh) throw Object.assign(new Error('OTP expired'), { statusCode: 410 });
      if (tries > 5) throw Object.assign(new Error('too many attempts'), { statusCode: 429 });
      if (!okPassword(newPassword))
        throw Object.assign(new Error('invalid new password'), { statusCode: 400 });
      if (String(body.otp || '') !== recObj.otp) {
        pendingOtp.set('otp', { ...recObj, tries });
        throw Object.assign(new Error('wrong OTP'), { statusCode: 401 });
      }
      const salt = randomBytes(16);
      const dataKey = randomBytes(32);
      const osWrapped = osProtect(dataKey);
      fs.writeFileSync(
        CRED_FILE(rootDir),
        JSON.stringify({
          version: 2,
          simId: osWrapped ? '' : rec.simId,
          recovery: osWrapped ? '' : rec.recovery,
          salt: salt.toString('base64'),
          verify: verifyHash(newPassword, salt).toString('base64'),
          wrapData: '',
          wrapPhrase: '',
          osProtected: osWrapped ?? '',
          osVersion: osWrapped ? 3 : 2,
          ...(osWrapped
            ? {
                recovery_os: osProtect(Buffer.from(rec.recovery, 'utf8')) ?? '',
                simId_os: osProtect(Buffer.from(rec.simId, 'utf8')) ?? '',
              }
            : {}),
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
