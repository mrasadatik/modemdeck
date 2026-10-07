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

const okPassword = (value: unknown): value is string =>
  typeof value === 'string' && value.length >= 4 && value.length <= 200;

/** Encrypted-at-rest onboarding, login, and lock control endpoints. */
export function createAuthRoutes({
  rootDir,
  repository,
  activeSimId,
}: {
  rootDir: string;
  repository: Repository<ModemDatabase>;
  activeSimId: () => string;
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
  };
}
