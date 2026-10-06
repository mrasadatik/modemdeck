import type { AtCommandPort } from '../../domain/ports/at-command-port.js';
import type {
  CapabilityEvidence,
  CapabilityMatrix,
  ModemIdentity,
  NetworkState,
  SimState,
} from '../../domain/entities/types.js';
import type { ModemProfile } from '../../domain/ports/modem-profile.js';
import { ModemProfileRegistry } from '../../domain/ports/modem-profile.js';

const evidence = async (port: AtCommandPort, command: string): Promise<CapabilityEvidence> => {
  const observedAt = new Date().toISOString();
  try {
    const observed = await port.execute(command, 5000);
    return { supported: true, command, observed, observedAt };
  } catch (error) {
    return {
      supported: false,
      command,
      observed: [],
      observedAt,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};
export class GenericStandardsProfile implements ModemProfile {
  readonly id = 'generic-standards';
  readonly displayName = 'Generic 3GPP AT';
  matches(): boolean {
    return true;
  }
  normalizeNetwork(lines: Record<string, string[]>): NetworkState {
    const raw = Object.values(lines).flat().join('\n');
    const status = Number(raw.match(/\+(?:C|CG|CE)REG:\s*\d(?:,\s*(\d))/)?.[1] ?? 0);
    const registration =
      (
        { 1: 'home', 5: 'roaming', 2: 'searching', 3: 'denied' } as Record<
          number,
          NetworkState['registration']
        >
      )[status] ?? 'not-registered';
    const csq = Number(raw.match(/\+CSQ:\s*(\d+)/)?.[1] ?? 99);
    return {
      registration,
      operator: raw.match(/\+COPS:\s*\d,\d,"([^"]+)"/)?.[1],
      technology: raw.match(/\+COPS:.*?,(\d+)/)?.[1],
      signal:
        csq === 99
          ? undefined
          : { csq, dbm: -113 + 2 * csq, percent: Math.round((csq / 31) * 100) },
    };
  }

  async probe(port: AtCommandPort): Promise<{
    identity: Partial<ModemIdentity>;
    capabilities: CapabilityMatrix;
    sim: SimState;
    network: NetworkState;
  }> {
    const empty = (): string[] => [];
    const identity: Partial<ModemIdentity> = {
      manufacturer: (await port.execute('AT+CGMI').catch(empty))[0],
      model: (await port.execute('AT+CGMM').catch(empty))[0],
      revision: (await port.execute('AT+CGMR').catch(empty))[0],
      imei: (await port.execute('AT+CGSN').catch(empty))[0],
      profileId: this.id,
    };
    const commands: Record<keyof CapabilityMatrix, string> = {
      sms: 'AT+CMGF?',
      ussd: 'AT+CUSD?',
      phonebook: 'AT+CPBS=?',
      forwarding: 'AT+CCFC=?',
      network: 'AT+CSQ',
      data: 'AT+CGDCONT?',
      pdu: 'AT+CMGF=0',
      binarySms: 'AT+CSCS?',
      deliveryReports: 'AT+CSMP?',
    };
    const entries = await Promise.all(
      Object.entries(commands).map(
        async ([key, command]) => [key, await evidence(port, command)] as const,
      ),
    );
    const capabilities = Object.fromEntries(entries) as unknown as CapabilityMatrix;
    const cpin = (await port.execute('AT+CPIN?').catch(empty))[0] ?? '';
    const sim: SimState = {
      status: /READY/i.test(cpin)
        ? 'ready'
        : /SIM PIN/i.test(cpin)
          ? 'pin-required'
          : /SIM PUK/i.test(cpin)
            ? 'puk-required'
            : /ABSENT/i.test(cpin)
              ? 'absent'
              : 'unknown',
      raw: cpin,
    };
    const responses: Record<string, string[]> = {};
    for (const command of ['AT+CSQ', 'AT+COPS?', 'AT+CREG?', 'AT+CGREG?', 'AT+CEREG?'])
      responses[command] = await port.execute(command).catch(empty);
    return { identity, capabilities, sim, network: this.normalizeNetwork(responses) };
  }
}

export function createProfileRegistry(): ModemProfileRegistry {
  return new ModemProfileRegistry().register(new GenericStandardsProfile());
}
