<script lang="ts">
  import { onDestroy } from 'svelte';
  import { api } from '../lib/api';
  import type { Network } from '../lib/types';
  import Page from './Page.svelte';
  import { abortScope, isAbort, notify } from '../lib/store';
  const aborts = abortScope();
  onDestroy(() => aborts.abortAll());
  let value: Network = {};
  let refreshing = false;
  export async function refresh(): Promise<void> {
    if (refreshing) return;
    refreshing = true;
    try {
      value = await api<Network>('network', undefined, { signal: aborts.signal() });
    } catch (error) {
      if (isAbort(error)) return;
      notify((error as Error).message, 'error');
    } finally {
      refreshing = false;
    }
  }
  void refresh();
</script>

<Page
  eyebrow="Live telemetry"
  title="Network health"
  description="Registration, signal, SIM, and modem identity."
  ><svelte:fragment slot="actions"
    ><button class="button secondary" disabled={refreshing} on:click={refresh}
      >{refreshing ? '↻ Refreshing…' : '↻ Refresh telemetry'}</button
    ></svelte:fragment
  >
  <div class="grid">
    <div class="card span-4">
      <div class="subtle">SIGNAL</div>
      <div class="metric">{value.signal ? `${value.signal.pct}%` : 'Unknown'}</div>
      <div class="subtle">{value.signal ? `${value.signal.dbm} dBm` : 'No signal reading'}</div>
      <div class="signal"><i style={`width:${value.signal?.pct || 0}%`}></i></div>
    </div>
    <div class="card span-8">
      <h3>Registration</h3>
      <div class="kv"><b>Operator</b><span>{value.operator || 'Unknown'}</span></div>
      <div class="kv"><b>Technology</b><span>{value.tech || 'Unknown'}</span></div>
      <div class="kv"><b>SIM</b><span>{value.sim || 'Unknown'}</span></div>
      <div class="kv">
        <b>Voice / data</b><span
          >{value.cs || 'n/a'} · {value.ps || 'n/a'} · {value.eps || 'n/a'}</span
        >
      </div>
    </div>
    <div class="card span-12">
      <h3>Device identity</h3>
      <div class="kv"><b>IMEI</b><span>{value.imei || 'Unknown'}</span></div>
      <div class="kv"><b>Firmware</b><span>{value.firmware || 'Unknown'}</span></div>
      <div class="kv"><b>APN context</b><span>{value.apn?.join(' ') || 'Unknown'}</span></div>
    </div>
  </div></Page
>
