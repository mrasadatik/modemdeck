<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from './lib/api';
  import {
    AntennaIcon,
    ArrowTurnForwardIcon,
    CallIcon,
    CodeIcon,
    ContactBookIcon,
    DashboardSquare01Icon,
    Globe02Icon,
    Mail01Icon,
    SentIcon,
    Settings02Icon,
  } from '@hugeicons/core-free-icons';
  import type { State } from './lib/types';
  import { activeView, defaultCountry, notify, status, toast } from './lib/store';
  import Sidebar from './components/Sidebar.svelte';
  import Topbar from './components/Topbar.svelte';
  import Dashboard from './components/Dashboard.svelte';
  import Messages from './components/Messages.svelte';
  import Network from './components/Network.svelte';
  import Data from './components/Data.svelte';
  import Tools from './components/Tools.svelte';
  import Operations from './components/Operations.svelte';
  import LockScreen from './components/LockScreen.svelte';

  const items = [
    { id: 'overview', icon: DashboardSquare01Icon, label: 'Overview' },
    { id: 'inbox', icon: Mail01Icon, label: 'Inbox' },
    { id: 'send', icon: SentIcon, label: 'Send SMS' },
    { id: 'ussd', icon: CodeIcon, label: 'USSD' },
    { id: 'calls', icon: CallIcon, label: 'Call log' },
    { id: 'contacts', icon: ContactBookIcon, label: 'Phonebook' },
    { id: 'network', icon: AntennaIcon, label: 'Network' },
    { id: 'forwarding', icon: ArrowTurnForwardIcon, label: 'Forwarding' },
    { id: 'data', icon: Globe02Icon, label: 'Mobile data' },
    { id: 'settings', icon: Settings02Icon, label: 'Capabilities' },
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
  let locked = true;
  let configured = false;
  let authChecked = false;
  async function checkAuth(): Promise<void> {
    try {
      const a = await api<{
        locked: boolean;
        configured: boolean;
        profile?: { country?: string };
      }>('auth/status');
      locked = a.locked;
      configured = a.configured;
      defaultCountry.set(a.profile?.country || '');
      authChecked = true;
    } catch {
      authChecked = true;
    }
  }
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
  async function manualLock(): Promise<void> {
    try {
      await api('auth/logout', {});
    } catch {
      /* ignore */
    }
    locked = true;
  }
  onMount(() => {
    void checkAuth();
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
    events.addEventListener('locked', () => (locked = true));
    return () => events.close();
  });
</script>

{#if !authChecked}
  <div class="empty">Loading…</div>
{:else if locked}
  <LockScreen
    {configured}
    onUnlock={() => {
      locked = false;
      void checkAuth();
      void refresh();
    }}
  />
{:else}
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
      <Topbar {labels} {refresh} onLock={manualLock} />
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
{/if}
