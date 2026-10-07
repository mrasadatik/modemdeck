import type { ModemDatabase } from '../domain/entities/types.js';
import type { LifecycleStatus } from '../infrastructure/modem/modem-lifecycle.js';

/**
 * Presentation-layer filter: a record is only visible when the SIM it was
 * recorded under is the one currently connected. When no SIM is identified
 * (modem disconnected, SIM unknown, or SIM swap) nothing is exposed.
 */
export function simScopedState(
  db: ModemDatabase,
  status: LifecycleStatus,
  activeSimId: string,
): {
  status: LifecycleStatus;
  sms: ModemDatabase['sms'];
  sent: ModemDatabase['sent'];
  calls: ModemDatabase['calls'];
  ussd: ModemDatabase['ussd'];
} {
  if (!status.connected || !activeSimId) return { status, sms: [], sent: [], calls: [], ussd: [] };
  return {
    status,
    sms: db.sms.filter((m) => m.simId === activeSimId).slice(0, 500),
    sent: db.sent.filter((m) => m.simId === activeSimId).slice(0, 100),
    calls: db.calls.filter((c) => c.simId === activeSimId).slice(0, 300),
    ussd: db.ussd.filter((u) => u.simId === activeSimId).slice(0, 50),
  };
}
