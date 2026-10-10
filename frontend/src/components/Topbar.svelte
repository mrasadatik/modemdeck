<script lang="ts">
  import { activeView, busy, status } from '../lib/store';
  import { carrierState } from '../lib/live';
  export let labels: Record<string, { title: string; description: string }>;
  export let refresh: () => void;
  export let refreshing = false;
  export let onLock: () => void = () => {};
  export let locking = false;
  $: connectionText = !$status.connected
    ? 'Disconnected'
    : $carrierState && ($carrierState.operator || $carrierState.signalPct !== null)
      ? `Connected · ${[$carrierState.operator, $carrierState.signalPct !== null ? `${$carrierState.signalPct}%` : ''].filter(Boolean).join(' ')}`
      : 'Connected';
</script>

<header class="topbar">
  <div>
    <h1>{labels[$activeView]?.title}</h1>
    <p>{labels[$activeView]?.description}</p>
  </div>
  <div class="top-actions">
    <button class="button secondary small" disabled={refreshing || $busy} on:click={refresh}
      >{refreshing ? '↻ Refreshing…' : '↻ Refresh'}</button
    >
    <!-- Lock is never gated: emergency sign-out must always work. -->
    <button class="button secondary small" disabled={locking} on:click={onLock}
      >{locking ? 'Locking…' : 'Lock'}</button
    >
    <div class:ok={$status.connected} class="connection">
      ● {connectionText}
    </div>
  </div>
</header>
