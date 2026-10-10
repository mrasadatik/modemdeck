<script lang="ts">
  import { onMount } from 'svelte';
  import SelectDropdown from './SelectDropdown.svelte';
  import {
    FALLBACK_COUNTRY,
    callingCodeFor,
    countryOptions,
    exampleFor,
    formatNationalInput,
    normalizeToE164,
    splitPhoneNumber,
  } from '../lib/phone-numbers-lib.js';

  const COUNTRY_OPTIONS = countryOptions();

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
  /** Bump to clear the number field without remounting (no focus loss). */
  export let clearToken = 0;
  /** When true, an empty field counts as valid (optional numbers). */
  export let allowEmpty = false;
  /** Locks country + number inputs (e.g. after OTP proof). */
  export let disabled = false;

  let national = '';
  let nationalInput: HTMLInputElement | null = null;
  let seenClearToken = 0;

  $: effectiveCountry = country || defaultCountry || '';
  $: callingCode = callingCodeFor(effectiveCountry) ?? '';
  $: placeholder = exampleFor(effectiveCountry || FALLBACK_COUNTRY)?.national ?? '';
  $: if (clearToken !== seenClearToken) clearInputs(clearToken);
  function clearInputs(token: number): void {
    // Change-detected reset: the written token is read back on the next
    // evaluation, so repeated tokens never clear twice.
    seenClearToken = token;
    national = '';
    e164 = '';
    valid = allowEmpty;
  }

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

  function onCountryPick(): void {
    // Re-mask and re-validate the digits under the newly selected country,
    // then hand focus to the number field.
    adopt(national);
    nationalInput?.focus();
  }

  onMount(() => {
    if (initialValue) adopt(initialValue);
    else valid = allowEmpty;
  });
</script>

<div class="phone3">
  <SelectDropdown
    bind:value={country}
    options={COUNTRY_OPTIONS}
    label={`${label} country`}
    searchPlaceholder="Search country…"
    previewClass="country-preview"
    previewFallback={defaultCountry}
    onPick={onCountryPick}
    {disabled}
  />
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
    aria-invalid={national !== '' && !valid}
    {placeholder}
    value={national}
    list={datalistId || undefined}
    inputmode="tel"
    autocomplete="tel-national"
    {disabled}
    bind:this={nationalInput}
    on:input={onNationalInput}
  />
</div>

<style>
  .phone3 {
    display: grid;
    gap: 8px;
    grid-template-columns: max-content 4.7em minmax(0, 1fr);
  }
  .calling-input {
    color: var(--muted);
    cursor: default;
    font-family: 'JetBrains Mono', monospace;
    overflow: hidden;
    padding-left: 8px;
    padding-right: 8px;
    text-overflow: ellipsis;
  }
  :global(.phone3 .country-preview) {
    font-family: 'JetBrains Mono', monospace;
    font-weight: 600;
    min-width: 78px;
  }
  @media (max-width: 520px) {
    .phone3 {
      grid-template-columns: 1fr;
    }
  }
</style>
