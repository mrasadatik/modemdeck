<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from './lib/api';
  import type { State } from './lib/types';
  import { activeView, notify, status, toast } from './lib/store';
  import Sidebar from './components/Sidebar.svelte';
  import Topbar from './components/Topbar.svelte';
  import Dashboard from './components/Dashboard.svelte';
  import Messages from './components/Messages.svelte';
  import Network from './components/Network.svelte';
  import Data from './components/Data.svelte';
  import Tools from './components/Tools.svelte';
  import Operations from './components/Operations.svelte';

  const items = [
    { id: 'overview', icon: '⌂', label: 'Overview' },
    { id: 'inbox', icon: '▱', label: 'Inbox' },
    { id: 'send', icon: '＋', label: 'Send SMS' },
    { id: 'ussd', icon: '⌁', label: 'USSD' },
    { id: 'calls', icon: '◌', label: 'Call log' },
    { id: 'contacts', icon: '♧', label: 'Phonebook' },
    { id: 'network', icon: '◉', label: 'Network' },
    { id: 'forwarding', icon: '↗', label: 'Forwarding' },
    { id: 'data', icon: '⇄', label: 'Mobile data' },
    { id: 'settings', icon: '⚙', label: 'Capabilities' },
  ];
  const labels = Object.fromEntries(
    items.map((item) => [
      item.id,
      { title: item.label, description: 'Control and observe your modem safely.' },
    ]),
  );
  let showWarning = true;
  if (typeof localStorage !== 'undefined' && localStorage.getItem('modemdeck-warning-dismissed'))
    showWarning = false;
  function dismissWarning(): void {
    showWarning = false;
    localStorage.setItem('modemdeck-warning-dismissed', '1');
  }
  let state: State = {
    status: { connected: false, port: '', error: '', capabilities: {} },
    sms: [],
    sent: [],
    calls: [],
    ussd: [],
  };
  async function refresh(): Promise<void> {
    try {
      state = await api<State>('state');
      status.set(state.status);
    } catch (error) {
      notify((error as Error).message);
    }
  }
  function open(view: string): void {
    activeView.set(view);
  }
  onMount(() => {
    void refresh();
    const events = new EventSource('/events');
    events.addEventListener('status', (event) => {
      const next = JSON.parse((event as MessageEvent).data);
      status.set(next);
      state.status = next;
      state = state;
    });
    events.addEventListener('sms', () => void refresh());
    events.addEventListener('call', () => void refresh());
    return () => events.close();
  });
</script>

<a class="skip-link" href="#main">Skip to content</a>
{#if showWarning}
  <div class="warning-banner" role="note">
    <p>
      ⚠ <strong>Personal, local use only.</strong> This console exposes SMS messages (which may include
      OTPs), call logs, and network controls. Bind it to a trusted machine, never expose it to a network,
      and comply with applicable laws and the terms of your mobile operator. You are solely responsible
      for lawful, ethical, and non-suspicious use — nothing here blocks you.
    </p>
    <button class="button secondary small" on:click={dismissWarning}>Dismiss</button>
  </div>
{/if}
<div class="app">
  <Sidebar {items} />
  <div class="content">
    <Topbar {labels} {refresh} />
    <main class="main" id="main">
      {#if $activeView === 'overview'}<Dashboard {state} {open} />
      {:else if ['inbox', 'send', 'ussd'].includes($activeView)}<Messages
          {state}
          mode={$activeView as 'inbox' | 'send' | 'ussd'}
        />
      {:else if $activeView === 'network'}<Network />
      {:else if $activeView === 'data'}<Data />
      {:else if $activeView === 'settings'}<Tools />
      {:else}<Operations {state} mode={$activeView as 'calls' | 'contacts' | 'forwarding'} />{/if}
    </main>
  </div>
</div>
{#if $toast}<div class="toast show" role="status" aria-live="polite">{$toast}</div>{/if}
