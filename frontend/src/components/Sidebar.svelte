<script lang="ts">
  import { activeView, busy, status } from '../lib/store';
  import { HugeiconsIcon } from '@hugeicons/svelte';
  export let items: Array<{ id: string; icon: unknown; label: string }>;
</script>

<aside class="sidebar">
  <div class="brand">
    <img class="brand-mark" src="/logo-sm.png" alt="ModemDeck logo" />
    <div><strong>ModemDeck</strong><small>PRIVATE DEVICE CONSOLE</small></div>
  </div>
  <div class="nav-label">Workspace</div>
  <nav aria-label="Primary">
    {#each items as item (item.id)}<button
        class:active={$activeView === item.id}
        aria-current={$activeView === item.id ? 'page' : undefined}
        disabled={$busy}
        on:click={() => activeView.set(item.id)}
        >{#if typeof item.icon === 'string'}<span aria-hidden="true">{item.icon}</span
          >{:else}<HugeiconsIcon
            icon={item.icon as never}
            size={18}
            color="currentColor"
            strokeWidth={1.5}
          />{/if}{item.label}</button
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
