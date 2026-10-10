import { fireEvent, render, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Messages from './Messages.svelte';
import { liveState, resetLiveState } from '../lib/live';

const seed = {
  status: { connected: true, port: 'COM4', error: '', capabilities: { sms: true, ussd: true } },
  sms: [],
  sent: [],
  calls: [],
  ussd: [],
};

describe('Messages workflows', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    resetLiveState();
    liveState.set(JSON.parse(JSON.stringify(seed)));
    vi.stubGlobal(
      'confirm',
      vi.fn(() => true),
    );
  });

  it('validates the send workflow through the API client', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            to: '+8801712345678',
            text: 'Hello from the console',
            ts: '2026-01-03',
            parts: 2,
          }),
        ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { getByPlaceholderText, getByRole, getByText } = render(Messages, {
      props: { mode: 'send' },
    });

    await fireEvent.input(getByPlaceholderText('01812-345678'), {
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
    // Optimistic entry is confirmed into the sent history without a refetch.
    await waitFor(() => expect(getByText('+8801712345678')).toBeTruthy());
  });

  it('suggests recent numbers while allowing new recipients', async () => {
    liveState.set({
      ...JSON.parse(JSON.stringify(seed)),
      sent: [{ to: '+15551234567', text: 'Hello', ts: '2026-01-01', parts: 1 }],
      sms: [{ id: 'message-1', from: '+15557654321', text: 'Hi', ts: '2026-01-02' }],
    });
    const { container, getByRole } = render(Messages, {
      props: { mode: 'send' },
    });
    const recipient = getByRole('combobox', { name: 'Destination number' }) as HTMLInputElement;
    expect(recipient.getAttribute('list')).toBe('recent-numbers');
    expect(
      [...container.querySelectorAll<HTMLOptionElement>('#recent-numbers option')].map(
        (item) => item.value,
      ),
    ).toEqual(['+15551234567', '+15557654321']);
    await fireEvent.input(recipient, { target: { value: '+19998887777' } });
    expect(recipient.value).toBe('+19998887777');
  });

  it('renders a USSD response and clears the submitted code', async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ text: 'Balance: 10', more: false })),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { getByPlaceholderText, getByRole, getAllByText } = render(Messages, {
      props: { mode: 'ussd' },
    });
    const input = getByPlaceholderText('*121#') as HTMLInputElement;

    await fireEvent.input(input, { target: { value: '*121#' } });
    await fireEvent.click(getByRole('button', { name: 'Send code' }));

    // Shown once in the result notice and once in the request history.
    await waitFor(() => expect(getAllByText('Balance: 10')).toHaveLength(2));
    expect(input.value).toBe('');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/ussd',
      expect.objectContaining({
        body: JSON.stringify({ code: '*121#' }),
      }),
    );
  });
});
