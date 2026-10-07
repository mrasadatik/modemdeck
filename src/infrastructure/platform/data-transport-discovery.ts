import type {
  DataTransportCandidate,
  DataTransportMethod,
} from '../../domain/entities/data-transport.js';
import type { PlatformCommand } from './modem-provider.js';
import { discoverMatchingRasProfiles } from './ras-profile-discovery.js';
import { listPlatformModems } from './modem-provider.js';

interface AdapterRow {
  Name?: string;
  Status?: string;
  InterfaceDescription?: string;
  ifIndex?: number;
}

const parseRows = <T>(text: string): T[] => {
  try {
    const value: unknown = JSON.parse(text);
    return (Array.isArray(value) ? value : [value]) as T[];
  } catch {
    return [];
  }
};

const adapterMethod = (row: AdapterRow): DataTransportMethod | undefined => {
  const value = `${row.Name || ''} ${row.InterfaceDescription || ''}`.toLowerCase();
  if (/\b(wi-?fi|wireless lan|ethernet|bluetooth|hyper-v|virtual)\b/.test(value)) return undefined;
  if (/\bmbim|mobile broadband|wwan\b/.test(value)) return 'mbim';
  if (/\brndis\b/.test(value)) return 'rndis';
  if (/\bqmi\b/.test(value)) return 'qmi';
  if (/\bqualcomm|usb.*network|usb.*ethernet\b/.test(value)) return 'ndis';
  return undefined;
};

export async function discoverPlatformDataTransports(
  run: PlatformCommand,
): Promise<DataTransportCandidate[]> {
  const [modems, adapters, ras] = await Promise.all([
    listPlatformModems(run),
    run('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      'Get-NetAdapter | Select-Object Name,Status,InterfaceDescription,ifIndex | ConvertTo-Json -Compress',
    ]),
    run('rasdial', []),
  ]);
  const candidates: DataTransportCandidate[] = [];
  const modemNames = modems.filter((item) => item.status === 'OK').map((item) => item.name);
  const profiles = await discoverMatchingRasProfiles({ modemNames });
  for (const profile of profiles)
    candidates.push({
      method: 'ras-ppp',
      control: 'controllable',
      name: profile,
      profile,
      modemName: modemNames[0],
      connected: new RegExp(`^Connected to\\s+${escapeRegExp(profile)}\\s*$`, 'mi').test(ras.out),
      evidence: ['matching OS RAS phonebook profile', 'matching installed modem provider'],
    });
  for (const row of parseRows<AdapterRow>(adapters.out)) {
    const method = adapterMethod(row);
    if (!method || !row.Name) continue;
    candidates.push({
      method,
      control: method === 'mbim' ? 'detectable-only' : 'unsupported',
      name: row.Name,
      interfaceIndex: typeof row.ifIndex === 'number' ? row.ifIndex : undefined,
      interfaceDescription: row.InterfaceDescription,
      connected: row.Status?.toLowerCase() === 'up',
      evidence: ['platform network adapter metadata'],
    });
  }
  return candidates;
}

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
