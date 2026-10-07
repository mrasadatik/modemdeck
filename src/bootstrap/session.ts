/** In-memory session key holder. Never persisted to disk. */
let sessionKey: Buffer | null = null;
let sessionStart = 0;

export function sessionKeyOrNull(): Buffer | null {
  return sessionKey;
}

export function sessionStartAt(): number {
  return sessionStart;
}

export function unlockSession(key: Buffer): void {
  // Zero any previous key before replacing it, whining for recovery of an earlier session.
  if (sessionKey) sessionKey.fill(0);
  sessionKey = key;
  sessionStart = Date.now();
}

export function lockSession(): void {
  if (sessionKey) sessionKey.fill(0); // best-effort scavenging of decrypted material
  sessionKey = null;
  sessionStart = 0;
}
