<script lang="ts">
  import { api, formatTime } from '../lib/api';
  import type { Compatibility, DataState, Health, Readiness } from '../lib/types';
  import Page from './Page.svelte';
  import { notify } from '../lib/store';
  import { ALL_COUNTRIES, countryNames } from '../lib/phone-numbers-lib.js';
  let capabilities: Record<string, boolean> = {};
  let health: Health | undefined;
  let readiness: Readiness | undefined;
  let compatibility: Compatibility | undefined;
  let configuration: Record<string, unknown> = {};
  let availablePorts: Array<{ path: string; label: string }> = [];
  let dialupProfiles: string[] = [];
  let profileName = '',
    profileCountry = '';
  async function saveProfile(): Promise<void> {
    try {
      await api('auth/profile', {
        name: profileName,
        country: profileCountry,
      });
      notify('Profile updated');
    } catch (error) {
      notify((error as Error).message);
    }
  }
  let port = '',
    baud = 115200,
    dialup = '',
    profile = 'generic-standards',
    capturePath = '',
    lockMinutes = 0,
    sessionMaxMinutes = 480,
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
  async function loadOptions(): Promise<void> {
    const [ports, data] = await Promise.allSettled([
      api<typeof availablePorts>('ports'),
      api<DataState>('data'),
    ]);
    if (ports.status === 'fulfilled') availablePorts = ports.value;
    else notify((ports.reason as Error).message);
    if (data.status === 'fulfilled')
      dialupProfiles = [
        ...new Set(
          (data.value.candidates || [])
            .filter(
              (candidate) => candidate.method === 'ras-ppp' && candidate.control === 'controllable',
            )
            .map((candidate) => candidate.name),
        ),
      ];
  }
  async function loadConfig(): Promise<void> {
    configuration = await api<Record<string, unknown>>('config');
    const auth = await api<{ profile?: Record<string, unknown> }>('auth/status').catch(
      () => ({}) as { profile?: Record<string, unknown> },
    );
    profileName = String(auth.profile?.name ?? '');
    profileCountry = String(auth.profile?.country ?? '');
    port = String(configuration.port || '');
    baud = Number(configuration.baud || 115200);
    dialup = String(configuration.dialup || '');
    profile = String(configuration.profile || 'generic-standards');
    capturePath = String(configuration.capturePath || '');
    lockMinutes = Number(configuration.lockMinutes) || 0;
    sessionMaxMinutes = Number(configuration.sessionMaxMinutes) || 480;
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
        lockMinutes,
        sessionMaxMinutes,
      });
      notify(
        result.hotReloaded ? 'Configuration saved and modem reconnected' : 'Configuration saved',
      );
      await loadConfig();
    } catch (error) {
      notify((error as Error).message);
    }
  }
  void Promise.all([refresh(), loadConfig(), loadOptions()]);
</script>

<Page
  eyebrow="Diagnostics"
  title="Capabilities"
  description="What this modem has actually reported during live probing."
  ><svelte:fragment slot="actions"
    ><button class="button secondary" on:click={() => void Promise.all([refresh(), loadOptions()])}
      >↻ Recheck</button
    ></svelte:fragment
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
      <h3>Profile defaults</h3>
      <p class="subtle">Your profile country & name; used to normalize every phone number.</p>
      <div class="grid">
        <label class="span-4"
          ><div class="label">Name</div>
          <input class="input" bind:value={profileName} aria-label="Profile name" /></label
        >
        <label class="span-4"
          ><div class="label">Default country</div>
          <select class="input" bind:value={profileCountry} aria-label="Default country">
            <option value="">None — require full international format</option>
            {#each ALL_COUNTRIES as code (code)}
              <option value={code}>{countryNames()[code] ?? code} ({code})</option>
            {/each}
          </select></label
        >
      </div>
      <div class="row end"><button class="button" on:click={saveProfile}>Save profile</button></div>
    </div>
    <div class="card span-12">
      <h3>Runtime configuration</h3>
      <p class="subtle">
        Port and baud changes are applied immediately by reconnecting the modem. HTTP, database, and
        authentication settings remain restart-only.
      </p>
      <div class="inline-badges" style="margin-top:10px">
        <span class="badge">HTTPS: {configuration.https === true ? 'on' : 'off'}</span>
        <span class="badge"
          >Auth token: {configuration.authConfigured === true ? 'configured' : 'none'}</span
        >
      </div>
      <div class="grid">
        <label class="span-4"
          ><div class="label">Modem port</div>
          <input
            class="input"
            bind:value={port}
            list="available-modem-ports"
            placeholder="Automatic"
          />
          <datalist id="available-modem-ports">
            {#each availablePorts as option (option.path)}<option value={option.path}
                >{option.label}</option
              >{/each}
          </datalist></label
        ><label class="span-4"
          ><div class="label">Baud rate</div>
          <input
            class="input"
            type="number"
            bind:value={baud}
            list="common-baud-rates"
            min="1200"
            max="4000000"
          />
          <datalist id="common-baud-rates">
            <option value="9600"></option><option value="57600"></option><option value="115200"
            ></option><option value="230400"></option><option value="460800"></option>
          </datalist></label
        ><label class="span-4"
          ><div class="label">Dial-up profile</div>
          <input
            class="input"
            bind:value={dialup}
            list="dialup-profiles"
            placeholder="Auto-discover"
          />
          <datalist id="dialup-profiles">
            {#each dialupProfiles as name (name)}<option value={name}></option>{/each}
          </datalist></label
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
        <label class="span-4"
          ><div class="label">Auto-lock (minutes, 0=off)</div>
          <input class="input" type="number" bind:value={lockMinutes} min="0" max="1440" /></label
        >
        <label class="span-4"
          ><div class="label">Session max (minutes)</div>
          <input
            class="input"
            type="number"
            bind:value={sessionMaxMinutes}
            min="0"
            max="10080"
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
