import type { CapabilityMatrix, ModemIdentity, NetworkState, SimState } from '../entities/types.js';
import type { AtCommandPort } from './at-command-port.js';

export interface ModemProfile {
  readonly id: string;
  readonly displayName: string;
  matches(identity: Partial<ModemIdentity>): boolean;
  probe(port: AtCommandPort): Promise<{
    identity: Partial<ModemIdentity>;
    capabilities: CapabilityMatrix;
    sim: SimState;
    network: NetworkState;
  }>;
  normalizeNetwork(lines: Record<string, string[]>): NetworkState;
}

export class ModemProfileRegistry {
  private readonly profiles: ModemProfile[] = [];
  register(profile: ModemProfile): this {
    this.profiles.push(profile);
    return this;
  }
  select(identity: Partial<ModemIdentity>): ModemProfile {
    return (
      this.profiles.find((profile) => profile.matches(identity)) ??
      this.profiles.find((profile) => profile.id === 'generic-standards') ??
      (() => {
        throw new Error('no modem profile is registered');
      })()
    );
  }
  all(): readonly ModemProfile[] {
    return this.profiles;
  }
}
