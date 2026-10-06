import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from './api';

describe('frontend API client', () => {
  afterEach(() => vi.restoreAllMocks());

  it('uses GET for reads and the correct health route', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    await api('health');
    expect(fetchMock).toHaveBeenCalledWith('/health', {
      method: 'GET',
      headers: undefined,
      body: undefined,
    });
  });

  it('uses POST JSON for modem commands', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ ok: 1 }), { status: 200 }));
    await api('sms', { to: '+1', text: 'hello' });
    expect(fetchMock).toHaveBeenCalledWith('/api/sms', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ to: '+1', text: 'hello' }),
    });
  });

  it('surfaces structured server errors', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'invalid destination number' }), { status: 400 }),
    );
    await expect(api('sms', { to: 'bad', text: 'x' })).rejects.toThrow(
      'invalid destination number',
    );
  });

  it('rejects malformed server responses', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('not-json', { status: 200 }));
    await expect(api('state')).rejects.toThrow('invalid response');
  });
});
