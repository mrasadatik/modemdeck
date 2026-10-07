import type { DataTransportCandidate } from '../../domain/entities/data-transport.js';
import type { PlatformCommand, PlatformModem } from './modem-provider.js';
import { discoverPlatformDataTransports } from './data-transport-discovery.js';
import { discoverMatchingRasProfiles } from './ras-profile-discovery.js';
import { listPlatformModems } from './modem-provider.js';

/** A provider abstracts OS-specific discovery/listing operations behind one seam. */
export interface PlatformProvider {
  id: string;
  platform: string;
  listModems(): Promise<PlatformModem[]>;
  discoverDataTransports(): Promise<DataTransportCandidate[]>;
  discoverDialupProfiles(): Promise<string[]>;
}

export function createWindowsProvider(run: PlatformCommand): PlatformProvider {
  return {
    id: 'windows',
    platform: 'win32',
    listModems: () => listPlatformModems(run),
    discoverDataTransports: () => discoverPlatformDataTransports(run),
    discoverDialupProfiles: async () => {
      const modems = await listPlatformModems(run);
      const modemNames = modems.filter((item) => item.status === 'OK').map((item) => item.name);
      return discoverMatchingRasProfiles({ modemNames });
    },
  };
}
