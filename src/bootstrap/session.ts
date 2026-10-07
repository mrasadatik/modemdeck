/** In-memory session key holder. Never persisted to disk. */
let sessionKey: Buffer | null = null;

export function sessionKeyOrNull(): Buffer | null {
  return sessionKey;
}

export function unlockSession(key: Buffer): void {
  sessionKey = key;
}

export function lockSession(): void {
  sessionKey = null;
}
