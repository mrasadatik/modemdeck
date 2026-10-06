import { fireEvent, render, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Messages from './Messages.svelte';
import type { State } from '../lib/types';

const state: State = {
  status: { connected: true, port: 'COM4', error: '', capabilities: { sms: true, ussd: true } },
  sms: [],
  sent: [],
  calls: [],
  ussd: [],
};

describe('Messages workflows', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal(
      'confirm',
      vi.fn(() => true),
    );
  });

  it('validates the send workflow through the API client', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ parts: 2 })));
    vi.stubGlobal('fetch', fetchMock);
    const { getByPlaceholderText, getByRole } = render(Messages, {
      props: { state, mode: 'send' },
    });

    await fireEvent.input(getByPlaceholderText('+880 1XXXXXXXXX'), {
      target: { value: '+8801712345678' },
    });
    await fireEvent.input(getByPlaceholderText('Write your message…'), {
      target: { value: 'Hello from the console' },
    });
    await fireEvent.click(getByRole('button', { name: 'Send message' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/sms',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ to: '+8801712345678', text: 'Hello from the console' }),
        }),
      ),
    );
  });

  it('renders a USSD response and clears the submitted code', async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ text: 'Balance: 10', more: false })),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { getByPlaceholderText, getByRole, getByText } = render(Messages, {
      props: { state, mode: 'ussd' },
    });
    const input = getByPlaceholderText('*121#') as HTMLInputElement;

    await fireEvent.input(input, { target: { value: '*121#' } });
    await fireEvent.click(getByRole('button', { name: 'Send code' }));

    await waitFor(() => expect(getByText('Balance: 10')).toBeTruthy());
    expect(input.value).toBe('');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/ussd',
      expect.objectContaining({
        body: JSON.stringify({ code: '*121#' }),
      }),
    );
  });
});
