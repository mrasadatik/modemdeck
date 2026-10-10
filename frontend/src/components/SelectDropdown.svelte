<script lang="ts">
  import { onDestroy, tick } from 'svelte';

  export interface SelectOption {
    value: string;
    label: string;
    hint?: string;
    /** Compact text shown when selected; defaults to the full label. */
    preview?: string;
  }

  /** Bound selected value. */
  export let value = '';
  export let options: SelectOption[] = [];
  /** Accessible name for the preview button and option list. */
  export let label = 'Select option';
  export let searchPlaceholder = 'Search…';
  /** Extra class for the preview button (e.g. country-preview). */
  export let previewClass = '';
  /** Shown when the selected option carries no preview (e.g. effective country code). */
  export let previewFallback = '';
  /** Called after the user picks a value. */
  export let onPick: (picked: string) => void = () => {};

  let open = false;
  let filter = '';
  let filterInput: HTMLInputElement | null = null;
  let root: HTMLElement | null = null;

  $: selected = options.find((option) => option.value === value);
  $: preview = selected?.preview ?? previewFallback ?? selected?.label ?? '––';
  $: searchable = options.length > 6;
  $: visibleOptions = options.filter((option) => {
    const query = filter.trim().toLowerCase();
    if (!query) return true;
    return (
      option.label.toLowerCase().includes(query) ||
      option.value.toLowerCase().includes(query) ||
      (option.hint ?? '').toLowerCase().includes(query)
    );
  });

  function onOutsidePointer(event: PointerEvent): void {
    if (root && !root.contains(event.target as Node)) setOpen(false);
  }

  function onEscape(event: KeyboardEvent): void {
    if (event.key === 'Escape') setOpen(false);
  }

  async function setOpen(next: boolean): Promise<void> {
    open = next;
    if (next) {
      filter = '';
      document.addEventListener('pointerdown', onOutsidePointer, true);
      document.addEventListener('keydown', onEscape, true);
      await tick();
      filterInput?.focus();
    } else {
      document.removeEventListener('pointerdown', onOutsidePointer, true);
      document.removeEventListener('keydown', onEscape, true);
    }
  }

  function pick(picked: string): void {
    value = picked;
    void setOpen(false);
    onPick(picked);
  }

  onDestroy(() => {
    document.removeEventListener('pointerdown', onOutsidePointer, true);
    document.removeEventListener('keydown', onEscape, true);
  });
</script>

<div class="select-dropdown" bind:this={root}>
  <button
    type="button"
    class="input select-preview {previewClass}"
    aria-haspopup="listbox"
    aria-expanded={open}
    aria-label={label}
    on:click={() => void setOpen(!open)}
  >
    <span class="preview-text">{preview}</span><span class="chevron" aria-hidden="true">▾</span>
  </button>
  {#if open}
    <div class="select-panel" role="listbox" aria-label={`${label} options`}>
      {#if searchable}
        <input
          class="input select-filter"
          placeholder={searchPlaceholder}
          aria-label={searchPlaceholder}
          bind:value={filter}
          bind:this={filterInput}
        />
      {/if}
      <div class="select-options">
        {#each visibleOptions as option (option.value + option.label)}
          <div
            class="select-option"
            role="option"
            aria-selected={value === option.value}
            tabindex="0"
            on:click={() => pick(option.value)}
            on:keydown={(event) => event.key === 'Enter' && pick(option.value)}
          >
            <span>{option.label}</span>
            {#if option.hint}<span class="muted">{option.hint}</span>{/if}
          </div>
        {:else}<div class="empty">No matches.</div>{/each}
      </div>
    </div>
  {/if}
</div>

<style>
  .select-dropdown {
    display: flex;
    position: relative;
  }
  .select-preview {
    align-items: center;
    cursor: pointer;
    display: flex;
    flex: 1;
    justify-content: space-between;
    gap: 8px;
    text-align: left;
  }
  .preview-text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .select-preview .chevron {
    color: var(--muted);
    flex-shrink: 0;
    font-size: 12px;
  }
  .select-panel {
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 9px;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.35);
    left: 0;
    min-width: 260px;
    padding: 8px;
    position: absolute;
    top: calc(100% + 6px);
    width: max-content;
    max-width: min(78vw, 340px);
    z-index: 40;
  }
  .select-filter {
    margin-bottom: 8px;
    padding: 8px 10px;
  }
  .select-options {
    max-height: 240px;
    overflow-y: auto;
  }
  .select-option {
    align-items: center;
    border-radius: 7px;
    cursor: pointer;
    display: flex;
    font-size: 14px;
    justify-content: space-between;
    gap: 12px;
    padding: 8px 10px;
  }
  .select-option:hover,
  .select-option:focus {
    background: var(--surface2);
    outline: 0;
  }
  .select-option[aria-selected='true'] {
    background: var(--surface2);
    font-weight: 600;
  }
  .select-option .muted {
    color: var(--muted);
    flex-shrink: 0;
    font-family: 'JetBrains Mono', monospace;
    font-size: 12px;
  }
  @media (max-width: 520px) {
    .select-panel {
      min-width: 0;
      width: 100%;
    }
  }
</style>
