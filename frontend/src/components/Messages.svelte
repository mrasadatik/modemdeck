<script lang="ts">
  import { onDestroy } from 'svelte';
  import { api, formatTime } from '../lib/api';
  import type { State } from '../lib/types';
  import Page from './Page.svelte';
  import PhoneNumberInput from './PhoneNumberInput.svelte';
  import { abortScope, defaultCountry, isAbort, notify } from '../lib/store';
  export let state: State;
  export let mode: 'inbox' | 'send' | 'ussd';
  const aborts = abortScope();
  onDestroy(() => aborts.abortAll());
  let toE164 = '',
    toValid = false,
    smsCountry = '',
    formKey = 0,
    actingPath: string | null = null,
    actingCtl: AbortController | null = null,
    sending = false,
    sendingCode = false,
    ussdCtl: AbortController | null = null,
    text = '',
    code = '',
    reply = '',
    result = 'No active session.';
  $: smsCountry = smsCountry || $defaultCountry;
  $: acting = actingPath !== null;
  $: recentNumbers = [
    ...new Set([
      ...state.sent.map((message) => message.to),
      ...state.sms.map((message) => message.from),
      ...state.calls.map((call) => call.number),
    ]),
  ]
    .filter((number) => number && number !== 'Unknown')
    .slice(0, 30);
  $: recentCodes = [...new Set(state.ussd.map((item) => item.code))].slice(0, 20);
  async function action(
    path: string,
    body: Record<string, unknown> = {},
    cancellable = false,
  ): Promise<void> {
    if (actingPath) return;
    actingPath = path;
    let controller: AbortController | null = null;
    let signal: AbortSignal;
    if (cancellable) {
      controller = new AbortController();
      actingCtl = controller;
      signal = controller.signal;
    } else {
      signal = aborts.signal();
    }
    try {
      await api(path, body, { signal });
      notify('Done', 'ok');
    } catch (error) {
      if (isAbort(error)) notify('Cancelled');
      else notify((error as Error).message, 'error');
    } finally {
      if (actingPath === path) actingPath = null;
      if (controller && actingCtl === controller) actingCtl = null;
    }
  }
  function cancelAction(): void {
    actingCtl?.abort();
  }
  async function send(): Promise<void> {
    if (sending) return;
    if (!toValid) return notify('Enter a valid recipient number', 'error');
    if (!confirm('Send this SMS? Your carrier may charge for it.')) return;
    sending = true;
    try {
      const sent = await api<{ parts: number }>(
        'sms',
        {
          to: toE164,
          text,
        },
        { signal: aborts.signal() },
      );
      notify(`Sent · ${sent.parts} part(s)`, 'ok');
      toE164 = '';
      toValid = false;
      formKey += 1;
      text = '';
    } catch (error) {
      if (isAbort(error)) return;
      notify((error as Error).message, 'error');
    } finally {
      sending = false;
    }
  }
  async function ussd(): Promise<void> {
    if (sendingCode) return;
    sendingCode = true;
    const controller = new AbortController();
    ussdCtl = controller;
    result = 'Sending…';
    try {
      const value = await api<{ text: string; more: boolean }>(
        'ussd',
        { code: code || reply },
        { signal: controller.signal },
      );
      result = value.text + (value.more ? '\n\nReply required' : '');
      code = '';
      reply = '';
    } catch (error) {
      result = isAbort(error) ? 'Cancelled.' : `⚠ ${(error as Error).message}`;
    } finally {
      if (ussdCtl === controller) ussdCtl = null;
      sendingCode = false;
    }
  }
  async function cancelUssd(): Promise<void> {
    if (sendingCode) {
      // Abort the start request, then release the modem-side session.
      ussdCtl?.abort();
      try {
        await api('ussd/cancel', {}, { signal: aborts.signal() });
      } catch {
        /* start teardown already handles feedback */
      }
      return;
    }
    await action('ussd/cancel');
  }
</script>

{#if mode === 'inbox'}<Page
    eyebrow="Messages"
    title="Inbox"
    description="Messages received by your modem."
    ><svelte:fragment slot="actions"
      ><button
        class="button secondary"
        disabled={acting && actingPath !== 'sync'}
        on:click={() => (actingPath === 'sync' ? cancelAction() : action('sync', {}, true))}
        >{actingPath === 'sync' ? 'Cancel' : '↻ Sync modem'}</button
      ><button
        class="button danger"
        disabled={acting && actingPath !== 'purge'}
        on:click={() =>
          actingPath === 'purge'
            ? cancelAction()
            : confirm('Delete all messages from the modem?') && action('purge', {}, true)}
        >{actingPath === 'purge' ? 'Cancel' : 'Clear modem'}</button
      ></svelte:fragment
    >
    <div class="card">
      {#each state.sms as message (message.id)}<div class="message">
          <div class="row between">
            <b>{message.from}</b><span class="subtle">{formatTime(message.ts)}</span>
          </div>
          <div class="message-text">{message.text}</div>
          <button
            class="button secondary small"
            disabled={acting}
            on:click={() => action('sms/delete', { id: message.id })}>Remove from archive</button
          >
        </div>{:else}<div class="empty">No messages yet.</div>{/each}
    </div></Page
  >
{:else if mode === 'send'}<Page
    eyebrow="Messages"
    title="Send a message"
    description="Unicode and international numbers are supported."
    ><div class="grid">
      <div class="card span-8">
        <div class="label">Recipient</div>
        {#key formKey}<PhoneNumberInput
            bind:country={smsCountry}
            defaultCountry={$defaultCountry}
            bind:e164={toE164}
            bind:valid={toValid}
            label="Destination number"
            datalistId="recent-numbers"
          />{/key}
        <datalist id="recent-numbers">
          {#each recentNumbers as number (number)}<option value={number}></option>{/each}
        </datalist>
        <div class="label">Message <span class="muted">{text.length} characters</span></div>
        <textarea rows="7" bind:value={text} placeholder="Write your message…"></textarea>
        <div class="row end">
          <button class="button" disabled={sending} on:click={send}
            >{sending ? 'Sending…' : 'Send message'}</button
          >
        </div>
      </div>
      <div class="card span-4">
        <h3>Sent recently</h3>
        {#each state.sent as message (message.ts + message.to)}<div class="message">
            <b>{message.to}</b>
            <div class="subtle">{formatTime(message.ts)} · {message.parts} part(s)</div>
            <div class="message-text">{message.text}</div>
          </div>{:else}<div class="empty">No sent messages.</div>{/each}
      </div>
    </div></Page
  >
{:else}<Page
    eyebrow="Network tools"
    title="USSD"
    description="Check balances, activate packs, and use carrier services."
    ><div class="grid">
      <div class="card span-8">
        <div class="label">USSD code</div>
        <div class="row">
          <input
            class="input"
            aria-label="USSD code"
            bind:value={code}
            list="recent-ussd-codes"
            placeholder="*121#"
          /><datalist id="recent-ussd-codes">
            {#each recentCodes as recentCode (recentCode)}<option value={recentCode}
              ></option>{/each}
          </datalist><button class="button" disabled={sendingCode} on:click={ussd}
            >{sendingCode ? 'Sending…' : 'Send code'}</button
          >
        </div>
        <div class="notice">{result}</div>
        <div class="row">
          <input
            class="input"
            aria-label="USSD reply"
            bind:value={reply}
            placeholder="Reply, e.g. 1"
          /><button class="button secondary" disabled={sendingCode} on:click={ussd}>Reply</button
          ><button class="button danger" disabled={acting} on:click={cancelUssd}
            >{sendingCode ? 'Cancel request' : 'Cancel'}</button
          >
        </div>
      </div>
      <div class="card span-4">
        <h3>Recent requests</h3>
        {#each state.ussd as item (item.ts + item.code)}<div class="message">
            <b>{item.code}</b>
            <div class="subtle">{formatTime(item.ts)}</div>
            <div class="message-text">{item.text}</div>
          </div>{/each}
      </div>
    </div></Page
  >{/if}
