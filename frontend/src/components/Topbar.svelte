<script lang="ts">
  import { activeView, status } from '../lib/store';
  export let labels: Record<string, { title: string; description: string }>;
  export let refresh: () => void;
  export let refreshing = false;
  export let onLock: () => void = () => {};
  export let locking = false;
</script>

<header class="topbar">
  <div>
    <h1>{labels[$activeView]?.title}</h1>
    <p>{labels[$activeView]?.description}</p>
  </div>
  <div class="top-actions">
    <button class="button secondary small" disabled={refreshing} on:click={refresh}
      >{refreshing ? '↻ Refreshing…' : '↻ Refresh'}</button
    >
    <button class="button secondary small" disabled={locking} on:click={onLock}
      >{locking ? 'Locking…' : 'Lock'}</button
    >
    <div class:ok={$status.connected} class="connection">
      ● {$status.connected ? 'Connected' : 'Disconnected'}
    </div>
  </div>
</header>
