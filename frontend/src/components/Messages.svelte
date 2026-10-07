<script lang="ts">
  import { api, formatTime } from '../lib/api';
  import type { State } from '../lib/types';
  import Page from './Page.svelte';
  import { defaultCountry, notify } from '../lib/store';
  import { parsePhoneNumberFromString } from 'libphonenumber-js';
  import { ALL_COUNTRIES, countryNames } from '../lib/phone-numbers-lib.js';
  export let state: State;
  export let mode: 'inbox' | 'send' | 'ussd';
  let to = '',
    smsCountry = '',
    text = '',
    code = '',
    reply = '',
    result = 'No active session.';
  $: smsCountry = smsCountry || $defaultCountry;
  function normalizeNumber(value: string, country: string): string {
    if (!value.trim()) return value;
    try {
      const p = parsePhoneNumberFromString(value.trim(), (country || undefined) as never);
      return p?.isValid() ? p.number : value;
    } catch {
      return value;
    }
  }
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
  async function action(path: string, body: Record<string, unknown> = {}): Promise<void> {
    try {
      await api(path, body);
      notify('Done');
    } catch (error) {
      notify((error as Error).message);
    }
  }
  async function send(): Promise<void> {
    if (!confirm('Send this SMS? Your carrier may charge for it.')) return;
    try {
      const sent = await api<{ parts: number }>('sms', {
        to: normalizeNumber(to, smsCountry),
        text,
      });
      notify(`Sent · ${sent.parts} part(s)`);
      to = '';
      text = '';
    } catch (error) {
      notify((error as Error).message);
    }
  }
  async function ussd(): Promise<void> {
    try {
      const value = await api<{ text: string; more: boolean }>('ussd', { code: code || reply });
      result = value.text + (value.more ? '\n\nReply required' : '');
      code = '';
      reply = '';
    } catch (error) {
      result = `⚠ ${(error as Error).message}`;
    }
  }
</script>

{#if mode === 'inbox'}<Page
    eyebrow="Messages"
    title="Inbox"
    description="Messages received by your modem."
    ><svelte:fragment slot="actions"
      ><button class="button secondary" on:click={() => action('sync')}>↻ Sync modem</button><button
        class="button danger"
        on:click={() => confirm('Delete all messages from the modem?') && action('purge')}
        >Clear modem</button
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
        <select class="input" bind:value={smsCountry} aria-label="Country of recipient">
          <option value="">Use profile default</option>
          {#each ALL_COUNTRIES as code (code)}
            <option value={code}>{countryNames()[code] ?? code} ({code})</option>
          {/each}
        </select>
        <input
          class="input"
          aria-label="Destination number"
          bind:value={to}
          list="recent-numbers"
          placeholder="+880 1XXXXXXXXX"
        />
        <datalist id="recent-numbers">
          {#each recentNumbers as number (number)}<option value={number}></option>{/each}
        </datalist>
        <div class="label">Message <span class="muted">{text.length} characters</span></div>
        <textarea rows="7" bind:value={text} placeholder="Write your message…"></textarea>
        <div class="row end"><button class="button" on:click={send}>Send message</button></div>
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
          </datalist><button class="button" on:click={ussd}>Send code</button>
        </div>
        <div class="notice">{result}</div>
        <div class="row">
          <input
            class="input"
            aria-label="USSD reply"
            bind:value={reply}
            placeholder="Reply, e.g. 1"
          /><button class="button secondary" on:click={ussd}>Reply</button><button
            class="button danger"
            on:click={() => action('ussd/cancel')}>Cancel</button
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
