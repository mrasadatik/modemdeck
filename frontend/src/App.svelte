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
  import {
    applyCall,
    applyCarrier,
    applySms,
    applyStatus,
    loadState,
    resetLiveState,
    sseLive,
  } from './lib/live';
  import { activeView, busy, defaultCountry, notify, status, toast, toastKind } from './lib/store';
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
  let sseWasLive = false;
  let showWarning = true;
  if (typeof localStorage !== 'undefined' && localStorage.getItem('modemdeck-warning-dismissed'))
    showWarning = false;
  let locked = true;
  let configured = false;
  let authChecked = false;
  let booted = false;
  let refreshing = false;
  let locking = false;
  /** This tab's session id (from login/setup responses or auth/status). */
  let sessionId = '';
  async function checkAuth(): Promise<void> {
    try {
      const a = await api<{
        locked: boolean;
        configured: boolean;
        profile?: { country?: string };
        session?: { id: string };
      }>('auth/status');
      locked = a.locked;
      configured = a.configured;
      if (a.session?.id) sessionId = a.session.id;
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
  async function refresh(): Promise<void> {
    try {
      await loadState();
    } catch (error) {
      notify((error as Error).message, 'error');
    }
  }
  async function onRefresh(): Promise<void> {
    if (refreshing) return;
    refreshing = true;
    try {
      await refresh();
    } finally {
      refreshing = false;
    }
  }
  function open(view: string): void {
    activeView.set(view);
  }
  async function manualLock(): Promise<void> {
    if (locking) return;
    locking = true;
    try {
      await api('auth/lock', {});
    } catch {
      /* ignore */
    }
    sessionId = '';
    locked = true;
    locking = false;
  }
  function parseLockedEvent(event: Event): string | undefined {
    try {
      const data = JSON.parse((event as MessageEvent).data) as { sessionId?: unknown };
      return typeof data.sessionId === 'string' ? data.sessionId : undefined;
    } catch {
      return undefined;
    }
  }
  function parseEvent(event: Event): unknown {
    try {
      return JSON.parse((event as MessageEvent).data);
    } catch {
      return null;
    }
  }
  let serverDown = false;
  let healthMisses = 0;
  /** Raw liveness probe: bypasses api() so routine checks never flash the progress bar. */
  async function probeHealth(): Promise<boolean> {
    try {
      const response = await fetch('/health');
      // 401 still proves the server is alive (token guard answered).
      return response.ok || response.status === 401;
    } catch {
      return false;
    }
  }
  async function boot(): Promise<void> {
    await checkAuth();
    if (!locked) {
      try {
        await loadState();
      } catch (error) {
        notify((error as Error).message, 'error');
      }
    }
    booted = true;
  }
  async function checkServer(): Promise<void> {
    if (document.visibilityState === 'hidden') return;
    if (await probeHealth()) {
      healthMisses = 0;
      if (serverDown) {
        serverDown = false;
        resetLiveState();
        await boot();
      }
      return;
    }
    healthMisses += 1;
    if (healthMisses >= 2 && !serverDown) {
      // Backend confirmed gone: wipe in-memory state so no stale
      // decrypted data stays on screen, and block the whole shell.
      serverDown = true;
      healthMisses = 0;
      resetLiveState();
      locked = true;
    }
  }
  onMount(() => {
    resetLiveState();
    void boot();
    const healthTimer = setInterval(() => void checkServer(), 10000);
    const events = new EventSource('/events');
    events.onopen = () => {
      // A reconnect silently resyncs anything missed while the channel was down.
      if (sseWasLive) void refresh();
      sseWasLive = true;
      sseLive.set(true);
    };
    events.onerror = () => {
      sseWasLive = false;
      sseLive.set(false);
      // Fast path: don't wait for the next poll when the channel drops.
      void checkServer();
    };
    events.addEventListener('status', (event) => applyStatus(parseEvent(event)));
    events.addEventListener('sms', (event) => applySms(parseEvent(event)));
    events.addEventListener('call', (event) => applyCall(parseEvent(event)));
    events.addEventListener('carrier', (event) => applyCarrier(parseEvent(event)));
    events.addEventListener('port', (event) => {
      const move = parseEvent(event) as { previous?: unknown; current?: unknown } | null;
      if (
        move &&
        typeof move.previous === 'string' &&
        typeof move.current === 'string' &&
        move.previous &&
        move.current
      )
        notify(`Modem moved from ${move.previous} to ${move.current}`, 'info');
    });
    events.addEventListener('locked', (event) => {
      // Per-session targeting: ignore lock events meant for other sessions.
      const target = parseLockedEvent(event);
      if (!target || target === sessionId) {
        sessionId = '';
        locked = true;
      }
    });
    return () => {
      clearInterval(healthTimer);
      events.close();
    };
  });
</script>

{#if !authChecked || !booted}
  <div class="empty">Loading…</div>
{:else if serverDown}
  <div
    class="warning-banner"
    role="alert"
    style="min-height:100dvh;align-items:center;justify-content:center"
  >
    <p>
      <strong>Server unreachable.</strong> The ModemDeck backend stopped answering — start it with
      <code>npm run start</code> and everything reappears here on its own. Nothing is shown meanwhile
      so stale data is never left on screen.
    </p>
    <button class="button secondary small" on:click={() => void checkServer()}>Retry now</button>
  </div>
{:else if locked && !$status.connected}
  <div
    class="warning-banner"
    role="alert"
    style="min-height:100dvh;align-items:center;justify-content:center"
  >
    <p>
      <strong>No modem detected.</strong> Actively looking for a device — the credential screen will
      activate once a SIM and modem are ready. Discovery retries automatically; replugging the modem
      restarts the search.
      {#if $status.error}<br /><span>Last modem report: {$status.error}</span>{/if}
      {#if $status.lastPort}<span> (last seen on {$status.lastPort})</span>{/if}
    </p>
    <button class="button secondary small" disabled={refreshing} on:click={onRefresh}
      >{refreshing ? 'Checking…' : 'Check again'}</button
    >
  </div>
{:else if locked}
  <LockScreen
    {configured}
    onUnlock={(sid?: string) => {
      if (sid) sessionId = sid;
      locked = false;
      void checkAuth();
      void refresh();
    }}
  />
{:else}
  <a class="skip-link" href="#main">Skip to content</a>
  {#if $busy}<div class="progress" role="progressbar" aria-label="Working"><i></i></div>{/if}
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
      <Topbar {labels} refresh={onRefresh} {refreshing} onLock={manualLock} {locking} />
      <main class="main" id="main" aria-busy={$busy}>
        {#if $activeView === 'overview'}<Dashboard {open} />
        {:else if ['inbox', 'send', 'ussd'].includes($activeView)}<Messages
            mode={$activeView as 'inbox' | 'send' | 'ussd'}
          />
        {:else if $activeView === 'network'}<Network />
        {:else if $activeView === 'data'}<Data />
        {:else if $activeView === 'settings'}<Tools />
        {:else}<Operations mode={$activeView as 'calls' | 'contacts' | 'forwarding'} />{/if}
      </main>
    </div>
  </div>
  {#if $toast}<div class="toast show {$toastKind}" role="status" aria-live="polite">
      {$toast}
    </div>{/if}
{/if}
