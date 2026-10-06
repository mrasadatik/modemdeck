<script lang="ts">
  import { activeView, status } from '../lib/store';
  export let labels: Record<string, { title: string; description: string }>;
  export let refresh: () => void;
</script>

<header class="topbar">
  <div>
    <h1>{labels[$activeView]?.title}</h1>
    <p>{labels[$activeView]?.description}</p>
  </div>
  <div class="top-actions">
    <button class="button secondary small" on:click={refresh}>↻ Refresh</button>
    <div class:ok={$status.connected} class="connection">
      ● {$status.connected ? 'Connected' : 'Disconnected'}
    </div>
  </div>
</header>
