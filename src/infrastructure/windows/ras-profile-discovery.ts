import fs from 'node:fs/promises';
import path from 'node:path';

export interface RasProfileDiscoveryOptions {
  modemName?: string;
  modemNames?: string[];
  userProfile?: string;
  programData?: string;
}

const normalize = (value: string): string => value.trim().replace(/\s+/g, ' ').toLowerCase();

export async function discoverMatchingRasProfiles(
  options: RasProfileDiscoveryOptions,
): Promise<string[]> {
  const modemNames = (options.modemNames || (options.modemName ? [options.modemName] : [])).map(
    normalize,
  );
  if (modemNames.length === 0) return [];
  const files = [
    path.join(
      options.userProfile || process.env.APPDATA || '',
      'Microsoft',
      'Network',
      'Connections',
      'Pbk',
      'rasphone.pbk',
    ),
    path.join(
      options.programData || process.env.ProgramData || '',
      'Microsoft',
      'Network',
      'Connections',
      'Pbk',
      'rasphone.pbk',
    ),
  ];
  const matches = new Set<string>();
  for (const file of files) {
    let content: string;
    try {
      content = await fs.readFile(file, 'utf8');
    } catch {
      continue;
    }
    let section = '';
    let values: Record<string, string> = {};
    const inspect = (): void => {
      const device = values.Device || values.Modem || '';
      if (modemNames.includes(normalize(device)) && section) matches.add(section);
    };
    for (const line of content.split(/\r?\n/)) {
      const header = line.match(/^\[([^\]]+)\]$/);
      if (header) {
        inspect();
        section = header[1];
        values = {};
        continue;
      }
      const entry = line.match(/^([^=]+)=(.*)$/);
      if (entry) values[entry[1].trim()] = entry[2].trim();
    }
    inspect();
  }
  return [...matches].sort();
}
