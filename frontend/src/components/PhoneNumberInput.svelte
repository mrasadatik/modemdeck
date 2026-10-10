<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import {
    ALL_COUNTRIES,
    FALLBACK_COUNTRY,
    callingCodeFor,
    countryNames,
    exampleFor,
    formatNationalInput,
    normalizeToE164,
    splitPhoneNumber,
  } from '../lib/phone-numbers-lib.js';

  interface CountryOption {
    code: string;
    name: string;
    calling: string;
  }

  const NAMES = countryNames();
  const COUNTRY_OPTIONS: CountryOption[] = ALL_COUNTRIES.map((code) => ({
    code,
    name: NAMES[code] ?? code,
    calling: callingCodeFor(code) ?? '',
  }));

  /** ISO country bound to the parent ('' = use defaultCountry). */
  export let country = '';
  /** Profile default country used when `country` is empty. */
  export let defaultCountry = '';
  /** Canonical E.164 output ('' while empty/invalid). */
  export let e164 = '';
  /** True when the current value is submittable. */
  export let valid = false;
  export let label = 'Phone number';
  /** Optional datalist id for recent-number suggestions. */
  export let datalistId = '';
  /** Initial full value (e.g. an existing rule number). */
  export let initialValue = '';
  /** When true, an empty field counts as valid (optional numbers). */
  export let allowEmpty = false;

  let national = '';
  let nationalInput: HTMLInputElement | null = null;
  let dropdownOpen = false;
  let filter = '';
  let root: HTMLElement | null = null;

  $: effectiveCountry = country || defaultCountry || '';
  $: callingCode = callingCodeFor(effectiveCountry) ?? '';
  $: placeholder = exampleFor(effectiveCountry || FALLBACK_COUNTRY)?.national ?? '';
  $: previewCode = effectiveCountry || '––';
  $: visibleOptions = COUNTRY_OPTIONS.filter((option) => {
    const query = filter.trim().toLowerCase();
    if (!query) return true;
    return (
      option.name.toLowerCase().includes(query) ||
      option.code.toLowerCase().includes(query) ||
      option.calling.toLowerCase().includes(query)
    );
  });

  function adopt(value: string): void {
    const raw = String(value ?? '').trim();
    if (!raw) {
      national = '';
      e164 = '';
      valid = allowEmpty;
      return;
    }
    if (raw.startsWith('+')) {
      const split = splitPhoneNumber(raw);
      if (split) {
        // Full international entry: auto-detect the country it belongs to.
        if (!country) country = split.country;
        national = formatNationalInput(split.nationalNumber, split.country);
        e164 = split.e164;
        valid = true;
        return;
      }
      national = raw;
      e164 = '';
      valid = false;
      return;
    }
    national = formatNationalInput(raw, effectiveCountry);
    const normalized = effectiveCountry
      ? normalizeToE164(national.replace(/\D/g, ''), effectiveCountry)
      : null;
    e164 = normalized ?? '';
    valid = allowEmpty ? normalized !== null || national === '' : normalized !== null;
  }

  function onNationalInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    adopt(input.value);
    if (input.value !== national) input.value = national;
  }

  function onCountryChange(): void {
    // Re-mask and re-validate the digits under the newly selected country.
    adopt(national);
  }

  function onOutsidePointer(event: PointerEvent): void {
    if (root && !root.contains(event.target as Node)) setDropdown(false);
  }

  function onEscape(event: KeyboardEvent): void {
    if (event.key === 'Escape') setDropdown(false);
  }

  function setDropdown(open: boolean): void {
    dropdownOpen = open;
    if (open) {
      filter = '';
      document.addEventListener('pointerdown', onOutsidePointer, true);
      document.addEventListener('keydown', onEscape, true);
    } else {
      document.removeEventListener('pointerdown', onOutsidePointer, true);
      document.removeEventListener('keydown', onEscape, true);
    }
  }

  function pickCountry(code: string): void {
    country = code;
    setDropdown(false);
    onCountryChange();
    nationalInput?.focus();
  }

  onDestroy(() => {
    document.removeEventListener('pointerdown', onOutsidePointer, true);
    document.removeEventListener('keydown', onEscape, true);
  });

  onMount(() => {
    if (initialValue) adopt(initialValue);
    else valid = allowEmpty;
  });
</script>

<div class="phone3" bind:this={root}>
  <div class="country-cell">
    <button
      type="button"
      class="input country-preview"
      aria-haspopup="listbox"
      aria-expanded={dropdownOpen}
      aria-label={`${label} country`}
      on:click={() => setDropdown(!dropdownOpen)}
    >
      <span class="code">{previewCode}</span><span class="chevron" aria-hidden="true">▾</span>
    </button>
    {#if dropdownOpen}
      <div class="country-panel" role="listbox" aria-label={`${label} country options`}>
        <input
          class="input country-filter"
          placeholder="Search country…"
          aria-label="Search country"
          bind:value={filter}
        />
        <div class="country-options">
          <div
            class="country-option"
            role="option"
            aria-selected={country === ''}
            tabindex="0"
            on:click={() => pickCountry('')}
            on:keydown={(event) => event.key === 'Enter' && pickCountry('')}
          >
            <span>Use profile default</span>
          </div>
          {#each visibleOptions as option (option.code)}
            <div
              class="country-option"
              role="option"
              aria-selected={country === option.code}
              tabindex="0"
              on:click={() => pickCountry(option.code)}
              on:keydown={(event) => event.key === 'Enter' && pickCountry(option.code)}
            >
              <span>{option.name} ({option.code})</span><span class="muted">{option.calling}</span>
            </div>
          {:else}<div class="empty">No matching country.</div>{/each}
        </div>
      </div>
    {/if}
  </div>
  <input
    class="input calling-input"
    value={callingCode || ''}
    placeholder="–––"
    readonly
    tabindex="-1"
    aria-label="Country calling code"
  />
  <input
    class="input"
    aria-label={label}
    {placeholder}
    value={national}
    list={datalistId || undefined}
    inputmode="tel"
    autocomplete="tel-national"
    bind:this={nationalInput}
    on:input={onNationalInput}
  />
</div>

<style>
  .phone3 {
    align-items: start;
    display: grid;
    gap: 8px;
    grid-template-columns: minmax(0, 0.9fr) minmax(0, 0.75fr) minmax(0, 2.35fr);
  }
  .country-cell {
    position: relative;
  }
  .country-preview {
    align-items: center;
    cursor: pointer;
    display: flex;
    font-family: 'JetBrains Mono', monospace;
    font-weight: 600;
    justify-content: space-between;
    text-align: left;
    width: 100%;
  }
  .country-preview .chevron {
    color: var(--muted);
    font-size: 12px;
  }
  .calling-input {
    color: var(--muted);
    cursor: default;
    font-family: 'JetBrains Mono', monospace;
  }
  .country-panel {
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
  .country-filter {
    margin-bottom: 8px;
    padding: 8px 10px;
  }
  .country-options {
    max-height: 240px;
    overflow-y: auto;
  }
  .country-option {
    align-items: center;
    border-radius: 7px;
    cursor: pointer;
    display: flex;
    font-size: 14px;
    justify-content: space-between;
    gap: 12px;
    padding: 8px 10px;
  }
  .country-option:hover,
  .country-option:focus {
    background: var(--surface2);
    outline: 0;
  }
  .country-option[aria-selected='true'] {
    background: var(--surface2);
    font-weight: 600;
  }
  .country-option .muted {
    color: var(--muted);
    font-family: 'JetBrains Mono', monospace;
    font-size: 12px;
  }
  @media (max-width: 520px) {
    .phone3 {
      grid-template-columns: 1fr;
    }
    .country-panel {
      min-width: 0;
      width: 100%;
    }
  }
</style>
