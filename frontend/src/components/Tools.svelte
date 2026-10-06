<script lang="ts">
  import { api, formatTime } from '../lib/api';
  import type { Compatibility, Health, Readiness } from '../lib/types';
  import Page from './Page.svelte';
  import { notify } from '../lib/store';
  let capabilities: Record<string, boolean> = {};
  let health: Health | undefined;
  let readiness: Readiness | undefined;
  let compatibility: Compatibility | undefined;
  let configuration: Record<string, unknown> = {};
  let port = '',
    baud = 115200,
    dialup = '',
    profile = 'generic-standards',
    capturePath = '',
    captureRaw = false;
  async function refresh(): Promise<void> {
    try {
      [capabilities, readiness, health, compatibility] = await Promise.all([
        api<Record<string, boolean>>('capabilities'),
        api<Readiness>('ready'),
        api<Health>('health'),
        api<Compatibility>('compatibility'),
      ]);
    } catch (error) {
      notify((error as Error).message);
    }
  }
  async function loadConfig(): Promise<void> {
    configuration = await api<Record<string, unknown>>('config');
    port = String(configuration.port || '');
    baud = Number(configuration.baud || 115200);
    dialup = String(configuration.dialup || '');
    profile = String(configuration.profile || 'generic-standards');
    capturePath = String(configuration.capturePath || '');
    captureRaw = configuration.captureRaw === true;
  }
  async function save(): Promise<void> {
    try {
      const result = await api<{ hotReloaded: boolean }>('config', {
        port,
        baud,
        dialup,
        profile,
        captureRaw,
        capturePath,
      });
      notify(
        result.hotReloaded ? 'Configuration saved and modem reconnected' : 'Configuration saved',
      );
      await loadConfig();
    } catch (error) {
      notify((error as Error).message);
    }
  }
  void Promise.all([refresh(), loadConfig()]);
</script>

<Page
  eyebrow="Diagnostics"
  title="Capabilities"
  description="What this modem has actually reported during live probing."
  ><svelte:fragment slot="actions"
    ><button class="button secondary" on:click={refresh}>↻ Recheck</button></svelte:fragment
  >
  <div class="grid">
    <div class="card span-4">
      <h3>Service health</h3>
      <div class="kv"><b>Health</b><span>{health?.ok ? 'Operational' : 'Unknown'}</span></div>
      <div class="kv">
        <b>Modem readiness</b><span>{readiness?.ready ? 'Ready' : 'Not ready'}</span>
      </div>
      <div class="kv"><b>Last check</b><span>{health ? formatTime(health.time) : '—'}</span></div>
    </div>
    <div class="card span-8">
      <h3>Compatibility evidence</h3>
      <div class="kv"><b>Profile</b><span>{compatibility?.profile || 'Unknown'}</span></div>
      <div class="kv">
        <b>Generated</b><span>{compatibility ? formatTime(compatibility.generatedAt) : '—'}</span>
      </div>
      <p class="subtle">{compatibility?.note || 'Only live observations are reported.'}</p>
    </div>
    <div class="card span-12">
      <h3>Runtime configuration</h3>
      <p class="subtle">
        Port and baud changes are applied immediately by reconnecting the modem. HTTP, database, and
        authentication settings remain restart-only.
      </p>
      <div class="grid">
        <label class="span-4"
          ><div class="label">Modem port</div>
          <input class="input" bind:value={port} placeholder="Automatic" /></label
        ><label class="span-4"
          ><div class="label">Baud rate</div>
          <input class="input" type="number" bind:value={baud} min="1200" max="4000000" /></label
        ><label class="span-4"
          ><div class="label">Dial-up profile</div>
          <input class="input" bind:value={dialup} placeholder="Auto-discover" /></label
        >
        <label class="span-4"
          ><div class="label">Modem profile</div>
          <input class="input" bind:value={profile} placeholder="generic-standards" /></label
        >
        <label class="span-4"
          ><div class="label">Trace file path</div>
          <input
            class="input"
            bind:value={capturePath}
            placeholder="data/traces/live.ndjson"
          /></label
        >
      </div>
      <label class="row"
        ><input type="checkbox" bind:checked={captureRaw} /> Capture raw modem trace</label
      >
      <div class="row end"><button class="button" on:click={save}>Save and apply</button></div>
    </div>
    {#each Object.entries(capabilities) as [name, supported] (name)}<div class="card span-4">
        <div class="row between">
          <b>{name}</b><span class="badge" class:ok={supported}
            >{supported ? 'Supported' : 'Unavailable'}</span
          >
        </div>
        <div class="subtle" style="margin-top:10px">
          {supported
            ? 'Observed during live modem probing.'
            : 'The modem did not confirm this capability.'}
        </div>
      </div>{/each}
  </div></Page
>
