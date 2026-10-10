<script lang="ts">
  import { onDestroy } from 'svelte';
  import { api } from '../lib/api';
  import type { DataState } from '../lib/types';
  import Page from './Page.svelte';
  import { abortScope, isAbort, notify } from '../lib/store';
  import { apnName, atCommand, formErrors } from '../../../src/domain/validation/schemas.js';
  import * as v from 'valibot';
  const aborts = abortScope();
  onDestroy(() => aborts.abortAll());
  let value: DataState = { configured: false, on: false },
    apn = '',
    command = '',
    output = '',
    toggling = false,
    toggleCtl: AbortController | null = null,
    savingApn = false,
    running = false,
    apnErrors: Record<string, string> = {},
    apnShown = false,
    atErrors: Record<string, string> = {},
    atShown = false;
  $: if (apnShown) apnErrors = formErrors(v.object({ apn: apnName() }), { apn });
  $: if (atShown) atErrors = formErrors(v.object({ cmd: atCommand() }), { cmd: command });
  async function refresh(): Promise<void> {
    try {
      value = await api<DataState>('data', undefined, { signal: aborts.signal() });
    } catch (error) {
      if (isAbort(error)) return;
      notify((error as Error).message, 'error');
    }
  }
  async function toggle(on: boolean): Promise<void> {
    if (toggling) return;
    toggling = true;
    const controller = new AbortController();
    toggleCtl = controller;
    try {
      value = await api<DataState>('data', { on }, { signal: controller.signal });
      notify(on ? 'Connecting…' : 'Disconnected', on ? 'info' : 'ok');
    } catch (error) {
      if (isAbort(error)) notify('Cancelled');
      else notify((error as Error).message, 'error');
    } finally {
      if (toggleCtl === controller) toggleCtl = null;
      toggling = false;
    }
  }
  function cancelToggle(): void {
    toggleCtl?.abort();
  }
  // Single-flight within the view: any running action blocks the other triggers.
  $: viewBusy = toggling || savingApn || running;
  async function saveApn(): Promise<void> {
    if (savingApn) return;
    apnShown = true;
    apnErrors = formErrors(v.object({ apn: apnName() }), { apn });
    if (Object.keys(apnErrors).length) return;
    savingApn = true;
    try {
      await api('apn', { apn }, { signal: aborts.signal() });
      notify('APN saved', 'ok');
    } catch (error) {
      if (isAbort(error)) return;
      notify((error as Error).message, 'error');
    } finally {
      savingApn = false;
    }
  }
  async function run(): Promise<void> {
    if (running) return;
    atShown = true;
    atErrors = formErrors(v.object({ cmd: atCommand() }), { cmd: command });
    if (Object.keys(atErrors).length) return;
    running = true;
    output = 'Running…';
    try {
      const result = await api<{ lines: string[] }>(
        'at',
        { cmd: command },
        { signal: aborts.signal() },
      );
      output = result.lines.join('\n') || 'OK';
    } catch (error) {
      output = isAbort(error) ? 'Cancelled.' : `⚠ ${(error as Error).message}`;
    } finally {
      running = false;
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
      </div>
      <p class="cost-note">⚠ Mobile data usage is billed by your carrier.</p>
      <div class="row">
        <button
          class="button"
          disabled={savingApn || running}
          on:click={() => (toggling ? cancelToggle() : toggle(true))}
          >{toggling ? 'Cancel' : 'Connect'}</button
        ><button class="button danger" disabled={viewBusy} on:click={() => toggle(false)}
          >Disconnect</button
        >
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
        <input
          class="input"
          aria-label="APN"
          aria-invalid={apnShown && !!apnErrors.apn}
          bind:value={apn}
          placeholder="internet"
        /><button class="button secondary" disabled={viewBusy} on:click={saveApn}
          >{savingApn ? 'Saving…' : 'Save'}</button
        >
      </div>
      {#if apnShown && apnErrors.apn}<p class="field-error">{apnErrors.apn}</p>{/if}
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
          aria-invalid={atShown && !!atErrors.cmd}
          bind:value={command}
          placeholder="AT+CSQ"
        /><button class="button secondary" disabled={viewBusy} on:click={run}
          >{running ? 'Running…' : 'Run command'}</button
        >
      </div>
      {#if atShown && atErrors.cmd}<p class="field-error">{atErrors.cmd}</p>{/if}
      <pre class="console">{output || 'Output will appear here.'}</pre>
    </div>
  </div></Page
>
