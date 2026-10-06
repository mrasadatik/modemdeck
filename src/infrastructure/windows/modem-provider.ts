export interface WindowsModem {
  name: string;
  attachedTo?: string;
  status?: string;
}

export type WindowsCommand = (
  file: string,
  args: string[],
) => Promise<{ ok: boolean; out: string }>;

export async function listWindowsModems(run: WindowsCommand): Promise<WindowsModem[]> {
  const result = await run('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    'Get-CimInstance Win32_POTSModem | Select-Object Name,AttachedTo,Status | ConvertTo-Json -Compress',
  ]);
  if (!result.ok || !result.out.trim()) return [];
  try {
    const parsed: unknown = JSON.parse(result.out);
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    return rows.flatMap((value) => {
      if (typeof value !== 'object' || value === null) return [];
      const row = value as Record<string, unknown>;
      return typeof row.Name === 'string'
        ? [
            {
              name: row.Name,
              attachedTo: typeof row.AttachedTo === 'string' ? row.AttachedTo : undefined,
              status: typeof row.Status === 'string' ? row.Status : undefined,
            },
          ]
        : [];
    });
  } catch {
    return [];
  }
}
