<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { api, formatTime } from '../lib/api';
  import type { State } from '../lib/types';
  import Page from './Page.svelte';
  import PhoneNumberInput from './PhoneNumberInput.svelte';
  import SelectDropdown from './SelectDropdown.svelte';
  import { abortScope, defaultCountry, isAbort, notify } from '../lib/store';
  export let mode: 'calls' | 'contacts' | 'forwarding';
  export let state: State;
  let store = 'SM',
    contacts: Array<{ index: number; number: string; name: string; source?: string }> = [],
    name = '',
    slot = '',
    dest = 'sim';
  let contactCountry = '',
    contactE164 = '',
    contactValid = false,
    contactKey = 0,
    forwardCountry = '';
  let forwardE164: Record<number, string> = {};
  let forwardValid: Record<number, boolean> = {};
  let acting = false;
  let loading = false;
  let actingRule: number | null = null;
  let ruleCtl: AbortController | null = null;
  const aborts = abortScope();
  onDestroy(() => aborts.abortAll());
  let forwarding: Array<{ reason: number; active: boolean; number: string }> = [];
  const labels = ['Always', 'When busy', 'No reply', 'Unreachable'];
  async function load(): Promise<void> {
    if (loading) return;
    loading = true;
    try {
      if (mode === 'contacts')
        contacts = await api<typeof contacts>(`phonebook?store=${store}`, undefined, {
          signal: aborts.signal(),
        });
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
    if (!forwardValid[reason]) return notify('Enter a valid forwarding number', 'error');
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
      {#if state.calls.length}<div class="table-scroll">
          <table>
            <tbody
              ><tr><th>Caller</th><th>Time</th></tr
              >{#each state.calls as call (call.ts + call.number)}<tr
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
            options={[
              { value: 'SM', label: 'SIM phonebook' },
              { value: 'ME', label: 'Modem phonebook' },
            ]}
            label="Phonebook store"
          /><button
            class="button secondary"
            disabled={loading || actingRule !== null}
            on:click={load}>{loading ? 'Loading…' : 'Reload'}</button
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
                        disabled={acting || actingRule !== null}
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
          <input class="input" aria-label="Contact name" bind:value={name} placeholder="Name" />
          {#key contactKey}<PhoneNumberInput
              bind:country={contactCountry}
              defaultCountry={$defaultCountry}
              bind:e164={contactE164}
              bind:valid={contactValid}
              label="Phone number"
            />{/key}
          <input
            class="input"
            aria-label="Phonebook slot"
            bind:value={slot}
            placeholder="First free slot"
          />
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
            disabled={acting || actingRule !== null}
            on:click={() => {
              if (!contactValid) return notify('Enter a valid contact number', 'error');
              action('phonebook', {
                store,
                name,
                number: contactE164,
                index: slot,
                dest,
              });
              contactE164 = '';
              contactValid = false;
              contactKey += 1;
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
            <span class="badge" class:ok={rule.active}>{rule.active ? 'Active' : 'Inactive'}</span>
          </div>
          <PhoneNumberInput
            bind:country={forwardCountry}
            defaultCountry={$defaultCountry}
            bind:e164={forwardE164[rule.reason]}
            bind:valid={forwardValid[rule.reason]}
            label={`Forwarding number (${labels[rule.reason]})`}
            initialValue={rule.number}
          />
          <div class="row">
            <button
              class="button"
              disabled={acting || (actingRule !== null && actingRule !== rule.reason)}
              on:click={() =>
                actingRule === rule.reason ? cancelRule() : enableForwarding(rule.reason)}
              >{actingRule === rule.reason ? 'Cancel' : 'Enable'}</button
            ><button
              class="button secondary"
              disabled={acting || actingRule !== null}
              on:click={() => action('forwarding', { reason: rule.reason, on: false, number: '' })}
              >Disable</button
            >
          </div>
        </div>{/each}
    </div></Page
  >{/if}
