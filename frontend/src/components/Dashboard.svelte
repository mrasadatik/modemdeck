<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { api, formatTime } from '../lib/api';
  import type { DataState, Network } from '../lib/types';
  import Page from './Page.svelte';
  import { abortScope, busy, isAbort, notify, status } from '../lib/store';
  import { liveState } from '../lib/live';
  export let open: (view: string) => void;
  const aborts = abortScope();
  onDestroy(() => aborts.abortAll());
  let data: DataState | undefined;
  let network: Network | undefined;
  onMount(() => {
    void refresh();
  });
  async function refresh(): Promise<void> {
    try {
      [data, network] = await Promise.all([
        api<DataState>('data', undefined, { signal: aborts.signal() }),
        api<Network>('network', undefined, { signal: aborts.signal() }),
      ]);
    } catch (error) {
      if (isAbort(error)) return;
      notify((error as Error).message, 'error');
    }
  }
</script>

<Page
  eyebrow="Command center"
  title="Good morning."
  description="Everything important about your modem, in one calm view."
>
  <svelte:fragment slot="actions"
    ><button class="button" on:click={() => open('network')}>View network health →</button
    ></svelte:fragment
  >
  <div class="grid">
    <div class="card span-4">
      <div class="subtle">DEVICE STATUS</div>
      <div class="metric" class:good={$status.connected}>
        {$status.connected ? 'Connected' : 'Disconnected'}
      </div>
      <div class="subtle">{$status.port || $status.error || 'Discovering control port'}</div>
    </div>
    <div class="card span-4">
      <div class="subtle">MOBILE DATA</div>
      <div class="metric">
        {data?.configured ? (data.on ? 'Connected' : 'Disconnected') : 'Unavailable'}
      </div>
      <div class="subtle">{data?.name || 'Checking OS dial-up profile'}</div>
    </div>
    <div class="card span-4">
      <div class="subtle">SIGNAL QUALITY</div>
      <div class="metric">{network?.signal ? `${network.signal.pct}%` : '—'}</div>
      <div class="subtle">{network?.operator || 'Network not loaded'}</div>
      <div class="signal"><i style={`width:${network?.signal?.pct || 0}%`}></i></div>
    </div>
    <div class="card span-8">
      <div class="row between">
        <h3>Recent messages</h3>
        <button class="button secondary small" on:click={() => open('inbox')}>Open inbox</button>
      </div>
      {#each $liveState.sms.slice(0, 3) as message (message.id)}<div class="message">
          <div class="row between">
            <b>{message.from}</b><span class="subtle">{formatTime(message.ts)}</span>
          </div>
          <div class="message-text">{message.text}</div>
        </div>{:else}<div class="empty">Your inbox is clear.</div>{/each}
    </div>
    <div class="card span-4">
      <h3>Quick actions</h3>
      <div class="stack">
        <button class="button" disabled={$busy} on:click={() => open('send')}>＋ Compose SMS</button
        ><button class="button secondary" disabled={$busy} on:click={() => open('ussd')}
          >Run USSD code</button
        ><button class="button secondary" disabled={$busy} on:click={() => open('data')}
          >Manage mobile data</button
        >
      </div>
    </div>
  </div>
</Page>
