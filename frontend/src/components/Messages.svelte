<script lang="ts">
  import { api, formatTime } from '../lib/api';
  import type { State } from '../lib/types';
  import Page from './Page.svelte';
  import { notify } from '../lib/store';
  export let state: State;
  export let mode: 'inbox' | 'send' | 'ussd';
  let to = '',
    text = '',
    code = '',
    reply = '',
    result = 'No active session.';
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
      const sent = await api<{ parts: number }>('sms', { to, text });
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
        <input
          class="input"
          aria-label="Destination number"
          bind:value={to}
          placeholder="+880 1XXXXXXXXX"
        />
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
            placeholder="*121#"
          /><button class="button" on:click={ussd}>Send code</button>
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
