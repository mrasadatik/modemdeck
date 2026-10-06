<script lang="ts">
  import { activeView, status } from '../lib/store';
  export let items: Array<{ id: string; icon: string; label: string }>;
</script>

<aside class="sidebar">
  <div class="brand">
    <div class="brand-mark" aria-hidden="true">⌁</div>
    <div><strong>ModemDeck</strong><small>PRIVATE DEVICE CONSOLE</small></div>
  </div>
  <div class="nav-label">Workspace</div>
  <nav aria-label="Primary">
    {#each items as item (item.id)}<button
        class:active={$activeView === item.id}
        aria-current={$activeView === item.id ? 'page' : undefined}
        on:click={() => activeView.set(item.id)}
        ><span aria-hidden="true">{item.icon}</span>{item.label}</button
      >{/each}
  </nav>
  <div class="side-bottom">
    <span class:ok={$status.connected} class="status-dot"></span>{$status.connected
      ? 'Connected'
      : 'Disconnected'}<br /><span
      >{$status.connected ? $status.port : $status.error || 'Scanning modem ports…'}</span
    >
  </div>
</aside>
