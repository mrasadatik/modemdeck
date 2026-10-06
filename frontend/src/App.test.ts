import { fireEvent, render, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App.svelte';

const state = {
  status: { connected: true, port: 'COM4', error: '', capabilities: { sms: true, network: true } },
  sms: [{ id: 'abc123456789', from: '+1', text: 'Hello', ts: '2026-01-01T00:00:00.000Z' }],
  sent: [],
  calls: [],
  ussd: [],
};

describe('App integration shell', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal(
      'EventSource',
      class {
        addEventListener(): void {}
        close(): void {}
      },
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const path = String(input);
        if (path.endsWith('/api/state')) return new Response(JSON.stringify(state));
        if (path.endsWith('/api/data'))
          return new Response(
            JSON.stringify({
              configured: true,
              on: false,
              name: 'Wireless Terminal',
              candidates: [],
            }),
          );
        if (path.endsWith('/api/network'))
          return new Response(
            JSON.stringify({ signal: { pct: 50, dbm: -90 }, operator: 'TestNet' }),
          );
        if (path.endsWith('/api/capabilities'))
          return new Response(JSON.stringify(state.status.capabilities));
        if (path.endsWith('/ready'))
          return new Response(JSON.stringify({ ready: true, modem: 'connected' }));
        if (path.endsWith('/health'))
          return new Response(
            JSON.stringify({ ok: true, service: 'test', time: new Date().toISOString() }),
          );
        if (path.endsWith('/api/compatibility'))
          return new Response(JSON.stringify({ observed: {}, note: 'test' }));
        return new Response(JSON.stringify({}), { status: 200 });
      }),
    );
  });

  it('loads the dashboard and navigates through the real feature shell', async () => {
    const { getByRole, getByText } = render(App);
    await waitFor(() => expect(getByText('Recent messages')).toBeTruthy());
    expect(getByText('Recent messages')).toBeTruthy();
    await fireEvent.click(getByRole('button', { name: /Network$/ }));
    expect(getByText('Network health')).toBeTruthy();
    await fireEvent.click(getByRole('button', { name: /Mobile data$/ }));
    expect(getByText('Connection')).toBeTruthy();
  });
});
