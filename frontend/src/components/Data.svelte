<script lang="ts">
  import { api } from '../lib/api';
  import type { DataState } from '../lib/types';
  import Page from './Page.svelte';
  import { notify } from '../lib/store';
  let value: DataState = { configured: false, on: false },
    apn = '',
    command = '',
    output = '';
  async function refresh(): Promise<void> {
    try {
      value = await api<DataState>('data');
    } catch (error) {
      notify((error as Error).message);
    }
  }
  async function toggle(on: boolean): Promise<void> {
    try {
      value = await api<DataState>('data', { on });
      notify(on ? 'Connecting…' : 'Disconnected');
    } catch (error) {
      notify((error as Error).message);
    }
  }
  async function saveApn(): Promise<void> {
    try {
      await api('apn', { apn });
      notify('APN saved');
    } catch (error) {
      notify((error as Error).message);
    }
  }
  async function run(): Promise<void> {
    try {
      const result = await api<{ lines: string[] }>('at', { cmd: command });
      output = result.lines.join('\n') || 'OK';
    } catch (error) {
      output = `⚠ ${(error as Error).message}`;
    }
  }
  void refresh();
</script>

<Page
  eyebrow="Connectivity"
  title="Mobile data"
  description="Control the OS data session and modem network profile."
  ><div class="grid">
    <div class="card span-8">
      <div class="row between">
        <div>
          <h3>Connection</h3>
          <div class="metric" class:good={value.on}>
            {value.configured ? (value.on ? 'Connected' : 'Disconnected') : 'Not configured'}
          </div>
        </div>
        <div class="row">
          <button class="button" on:click={() => toggle(true)}>Connect</button><button
            class="button danger"
            on:click={() => toggle(false)}>Disconnect</button
          >
        </div>
      </div>
      {#each value.candidates || [] as candidate (candidate.name)}<div class="kv">
          <b>{candidate.method}</b><span
            >{candidate.name}
            <span class="badge" class:ok={candidate.control === 'controllable'}
              >{candidate.control}</span
            ></span
          >
        </div>{/each}
    </div>
    <div class="card span-4">
      <h3>APN configuration</h3>
      <p class="subtle">Changing APN affects packet data.</p>
      <div class="row">
        <input class="input" aria-label="APN" bind:value={apn} placeholder="internet" /><button
          class="button secondary"
          on:click={saveApn}>Save</button
        >
      </div>
    </div>
    <div class="card span-12">
      <div class="row between">
        <h3>Advanced AT console</h3>
        <span class="badge">Use with care</span>
      </div>
      <div class="row">
        <input
          class="input"
          aria-label="AT command"
          bind:value={command}
          placeholder="AT+CSQ"
        /><button class="button secondary" on:click={run}>Run command</button>
      </div>
      <pre class="console">{output || 'Output will appear here.'}</pre>
    </div>
  </div></Page
>
