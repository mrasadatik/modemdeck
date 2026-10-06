export type Json = Record<string, unknown>;

export async function api<T = Json>(path: string, body?: Json): Promise<T> {
  const prefix = path === 'health' || path === 'ready' ? '/' : '/api/';
  const response = await fetch(`${prefix}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new Error('The service returned an invalid response');
  }
  if (!response.ok) throw new Error(((value as Json).error as string) || 'Request failed');
  return value as T;
}

export const formatTime = (value: string): string => new Date(value).toLocaleString();
