import { afterEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { api } from './api';
import { abortScope, busyCount, isAbort, notify, toast, activeView, status } from './store';

describe('frontend API client teardown cases', () => {
  afterEach(() => vi.restoreAllMocks());

  it('maps ready to /ready', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ ready: true }), { status: 200 }));
    await api('ready');
    expect(fetchMock).toHaveBeenCalledWith('/ready', expect.anything());
  });

  it('falls back to Request failed when the error payload has no message', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ weird: true }), { status: 500 }),
    );
    await expect(api('state')).rejects.toThrow('Request failed');
  });

  it('throws a readable error when an error response is not JSON', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('<html>', { status: 502 }));
    await expect(api('state')).rejects.toThrow('invalid response');
  });

  it('propagates network failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('fetch failed'));
    await expect(api('state')).rejects.toThrow('fetch failed');
  });

  it('handles empty 200 body gracefully via error path', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 200 }));
    await expect(api('state')).rejects.toThrow('invalid response');
  });
});

describe('frontend store teardown cases', () => {
  it('notify sets and auto-clears the toast', async () => {
    vi.useFakeTimers();
    notify('hello');
    expect(get(toast)).toBe('hello');
    vi.advanceTimersByTime(4000);
    expect(get(toast)).toBe('');
    vi.useRealTimers();
  });

  it('rapid notifications only clear the last one', () => {
    vi.useFakeTimers();
    notify('one');
    vi.advanceTimersByTime(3000);
    notify('two');
    vi.advanceTimersByTime(1000);
    expect(get(toast)).toBe('two');
    vi.advanceTimersByTime(3000);
    expect(get(toast)).toBe('');
    vi.useRealTimers();
  });

  it('defaults are sane and safe to render', () => {
    expect(get(activeView)).toBeTruthy();
    expect(get(status).connected).toBe(false);
  });

  it('recognizes cancellation errors', () => {
    const abort = new DOMException('This operation was aborted', 'AbortError');
    expect(isAbort(abort)).toBe(true);
    expect(isAbort(new Error('wrong password'))).toBe(false);
    expect(isAbort(null)).toBe(false);
  });

  it('abort scopes cancel tracked signals together', () => {
    const scope = abortScope();
    const first = scope.signal();
    const second = scope.signal();
    expect(first.aborted).toBe(false);
    scope.abortAll();
    expect(first.aborted).toBe(true);
    expect(second.aborted).toBe(true);
  });

  it('api requests clear the busy counter even when aborted', async () => {
    const controller = new AbortController();
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          controller.signal.addEventListener('abort', () =>
            reject(new DOMException('This operation was aborted', 'AbortError')),
          );
        }),
    );
    const pending = api('state', undefined, { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toThrow();
    expect(get(busyCount)).toBe(0);
  });
});
