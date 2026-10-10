<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { api, formatTime } from '../lib/api';
  import Page from './Page.svelte';
  import PhoneNumberInput from './PhoneNumberInput.svelte';
  import SelectDropdown from './SelectDropdown.svelte';
  import { abortScope, defaultCountry, isAbort, notify } from '../lib/store';
  import { liveState } from '../lib/live';
  import {
    contactForm,
    forwardingForm,
    formErrors,
    phonebookIndex,
  } from '../../../src/domain/validation/schemas.js';
  import * as v from 'valibot';
  export let mode: 'calls' | 'contacts' | 'forwarding';
  let store = 'SM',
    contacts: Array<{ index: number; number: string; name: string; source?: string }> = [],
    name = '',
    slot = '',
    dest = 'sim';
  let phonebookStores = ['SM', 'ME'];
  const storeLabel = (value: string): string =>
    value === 'SM' ? 'SIM phonebook' : value === 'ME' ? 'Modem phonebook' : `${value} storage`;
  let contactCountry = '',
    contactE164 = '',
    contactClearToken = 0,
    forwardCountry = '';
  let forwardE164: Record<number, string> = {};
  let acting = false;
  let loading = false;
  let actingRule: number | null = null;
  // Single-flight within the view: any running action blocks the other triggers.
  $: viewBusy = acting || loading || actingRule !== null;
  let ruleCtl: AbortController | null = null;
  let contactErrors: Record<string, string> = {};
  let contactShown = false;
  let ruleErrors: Record<number, Record<string, string>> = {};
  let ruleShown: Record<number, boolean> = {};
  const aborts = abortScope();
  onDestroy(() => aborts.abortAll());
  const slotSchema = () => v.object({ slot: phonebookIndex() });
  function validateContact(): Record<string, string> {
    const errors = formErrors(contactForm(contactCountry || $defaultCountry || undefined), {
      name,
      number: contactE164,
    });
    return { ...errors, ...formErrors(slotSchema(), { slot }) };
  }
  $: if (contactShown) contactErrors = validateContact();
  function validateRule(reason: number): Record<string, string> {
    return formErrors(forwardingForm(forwardCountry || $defaultCountry || undefined), {
      reason,
      number: forwardE164[reason] ?? '',
    });
  }
  $: {
    const next: Record<number, Record<string, string>> = {};
    for (const [reason, shown] of Object.entries(ruleShown))
      if (shown) next[Number(reason)] = validateRule(Number(reason));
    if (Object.keys(next).length) ruleErrors = next;
  }
  let forwarding: Array<{ reason: number; active: boolean; number: string; error?: string }> = [];
  const labels = ['Always', 'When busy', 'No reply', 'Unreachable'];
  async function load(): Promise<void> {
    if (loading) return;
    loading = true;
    try {
      if (mode === 'contacts') {
        try {
          const found = await api<{ stores: string[] }>('phonebook/stores', undefined, {
            signal: aborts.signal(),
          });
          if (found.stores?.length) {
            phonebookStores = found.stores;
            if (!phonebookStores.includes(store)) store = phonebookStores[0];
          }
        } catch (error) {
          if (!isAbort(error)) phonebookStores = ['SM', 'ME'];
          else return;
        }
        contacts = await api<typeof contacts>(`phonebook?store=${store}`, undefined, {
          signal: aborts.signal(),
        });
      }
      if (mode === 'forwarding')
        forwarding = await api<typeof forwarding>('forwarding', undefined, {
          signal: aborts.signal(),
        });
    } catch (error) {
      if (isAbort(error)) return;
      notify((error as Error).message, 'error');
    } finally {
      loading = false;
    }
  }
  async function action(path: string, body: Record<string, unknown>): Promise<void> {
    if (acting || actingRule !== null) return;
    acting = true;
    try {
      await api(path, body, { signal: aborts.signal() });
      notify('Done', 'ok');
      await load();
    } catch (error) {
      if (isAbort(error)) return;
      notify((error as Error).message, 'error');
    } finally {
      acting = false;
    }
  }
  async function enableForwarding(reason: number): Promise<void> {
    if (acting || actingRule !== null) return;
    ruleShown = { ...ruleShown, [reason]: true };
    const errs = validateRule(reason);
    ruleErrors = { ...ruleErrors, [reason]: errs };
    if (Object.keys(errs).length) return;
    actingRule = reason;
    const controller = new AbortController();
    ruleCtl = controller;
    try {
      await api(
        'forwarding',
        { reason, on: true, number: forwardE164[reason] },
        { signal: controller.signal },
      );
      notify('Done', 'ok');
      await load();
    } catch (error) {
      if (isAbort(error)) notify('Cancelled');
      else notify((error as Error).message, 'error');
    } finally {
      if (actingRule === reason) actingRule = null;
      if (ruleCtl === controller) ruleCtl = null;
    }
  }
  function cancelRule(): void {
    ruleCtl?.abort();
  }
  onMount(() => {
    void load();
  });
</script>

{#if mode === 'calls'}<Page
    eyebrow="Communication"
    title="Call log"
    description="Incoming caller-ID events captured by the modem."
    ><div class="card">
      <div class="notice">
        This device exposes caller ID but has no audio path, so calls cannot be placed or answered
        here.
      </div>
      {#if $liveState.calls.length}<div class="table-scroll">
          <table>
            <tbody
              ><tr><th>Caller</th><th>Time</th></tr
              >{#each $liveState.calls as call (call.ts + call.number)}<tr
                  ><td>{call.number}</td><td>{formatTime(call.ts)}</td></tr
                >{/each}</tbody
            >
          </table>
        </div>{:else}<div class="empty">No incoming calls recorded.</div>{/if}
    </div></Page
  >
{:else if mode === 'contacts'}<Page
    eyebrow="Contacts"
    title="Phonebook"
    description="Manage contacts on the SIM or modem storage."
    ><div class="grid">
      <div class="card span-8">
        <div class="row">
          <SelectDropdown
            bind:value={store}
            options={phonebookStores.map((value) => ({ value, label: storeLabel(value) }))}
            label="Phonebook store"
          /><button class="button secondary" disabled={viewBusy} on:click={load}
            >{loading ? 'Loading…' : 'Reload'}</button
          >
        </div>
        {#if contacts.length}<div class="table-scroll">
            <table>
              <tbody
                ><tr><th>Slot</th><th>Name</th><th>Number</th><th></th></tr
                >{#each contacts as contact (contact.index)}<tr
                    ><td>{contact.index}</td><td>{contact.name}</td><td>{contact.number}</td><td
                      ><button
                        class="button danger small"
                        disabled={viewBusy}
                        on:click={() =>
                          action('phonebook/delete', {
                            store,
                            index: contact.index,
                            dest: contact.source === 'app' ? 'app' : 'sim',
                          })}>Delete</button
                      ></td
                    ></tr
                  >{/each}</tbody
              >
            </table>
          </div>{:else}<div class="empty">No contacts found.</div>{/if}
      </div>
      <div class="card span-4">
        <h3>Add contact</h3>
        <div class="stack">
          <input
            class="input"
            aria-label="Contact name"
            aria-invalid={contactShown && !!contactErrors.name}
            bind:value={name}
            placeholder="Name"
          />
          {#if contactShown && contactErrors.name}<p class="field-error">
              {contactErrors.name}
            </p>{/if}
          <PhoneNumberInput
            bind:country={contactCountry}
            defaultCountry={$defaultCountry}
            bind:e164={contactE164}
            label="Phone number"
            clearToken={contactClearToken}
          />
          {#if contactShown && contactErrors.number}<p class="field-error">
              {contactErrors.number}
            </p>{/if}
          <input
            class="input"
            aria-label="Phonebook slot"
            aria-invalid={contactShown && !!contactErrors.slot}
            bind:value={slot}
            placeholder="First free slot"
          />
          {#if contactShown && contactErrors.slot}<p class="field-error">
              {contactErrors.slot}
            </p>{/if}
          <SelectDropdown
            bind:value={dest}
            options={[
              { value: 'sim', label: 'Save to SIM' },
              { value: 'app', label: 'Save inside app (encrypted)' },
            ]}
            label="Save destination"
          />
          <button
            class="button"
            disabled={viewBusy}
            on:click={() => {
              contactShown = true;
              contactErrors = validateContact();
              if (Object.keys(contactErrors).length) return;
              action('phonebook', {
                store,
                name,
                number: contactE164,
                index: slot,
                dest,
              });
              contactE164 = '';
              contactShown = false;
              contactClearToken += 1;
            }}>{acting ? 'Saving…' : 'Save contact'}</button
          >
        </div>
      </div>
    </div></Page
  >
{:else}<Page
    eyebrow="Calling services"
    title="Call forwarding"
    description="Control carrier forwarding rules from one place."
    ><div class="grid">
      {#each forwarding as rule (rule.reason)}<div class="card span-6">
          <div class="row between">
            <h3>{labels[rule.reason]}</h3>
            <span class="badge" class:ok={rule.active}
              >{rule.active ? 'Active' : rule.error ? 'Unknown' : 'Inactive'}</span
            >
          </div>
          {#if rule.error}<p class="subtle">Couldn't read this rule: {rule.error}</p>{/if}
          <PhoneNumberInput
            bind:country={forwardCountry}
            defaultCountry={$defaultCountry}
            bind:e164={forwardE164[rule.reason]}
            label={`Forwarding number (${labels[rule.reason]})`}
            initialValue={rule.number}
          />
          {#if ruleShown[rule.reason] && ruleErrors[rule.reason]?.number}<p class="field-error">
              {ruleErrors[rule.reason].number}
            </p>{/if}
          <div class="row">
            <button
              class="button"
              disabled={viewBusy && actingRule !== rule.reason}
              on:click={() =>
                actingRule === rule.reason ? cancelRule() : enableForwarding(rule.reason)}
              >{actingRule === rule.reason ? 'Cancel' : 'Enable'}</button
            ><button
              class="button secondary"
              disabled={viewBusy}
              on:click={() => action('forwarding', { reason: rule.reason, on: false, number: '' })}
              >Disable</button
            >
          </div>
        </div>{/each}
    </div></Page
  >{/if}
