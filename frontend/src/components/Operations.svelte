<script lang="ts">
  import { onMount } from 'svelte';
  import { api, formatTime } from '../lib/api';
  import type { State } from '../lib/types';
  import Page from './Page.svelte';
  import { notify } from '../lib/store';
  export let mode: 'calls' | 'contacts' | 'forwarding';
  export let state: State;
  let store = 'SM',
    contacts: Array<{ index: number; number: string; name: string }> = [],
    name = '',
    number = '',
    slot = '';
  let forwarding: Array<{ reason: number; active: boolean; number: string }> = [];
  const labels = ['Always', 'When busy', 'No reply', 'Unreachable'];
  async function load(): Promise<void> {
    try {
      if (mode === 'contacts') contacts = await api<typeof contacts>(`phonebook?store=${store}`);
      if (mode === 'forwarding') forwarding = await api<typeof forwarding>('forwarding');
    } catch (error) {
      notify((error as Error).message);
    }
  }
  async function action(path: string, body: Record<string, unknown>): Promise<void> {
    try {
      await api(path, body);
      notify('Done');
      await load();
    } catch (error) {
      notify((error as Error).message);
    }
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
      {#if state.calls.length}<table>
          <tbody
            ><tr><th>Caller</th><th>Time</th></tr
            >{#each state.calls as call (call.ts + call.number)}<tr
                ><td>{call.number}</td><td>{formatTime(call.ts)}</td></tr
              >{/each}</tbody
          >
        </table>{:else}<div class="empty">No incoming calls recorded.</div>{/if}
    </div></Page
  >
{:else if mode === 'contacts'}<Page
    eyebrow="Contacts"
    title="Phonebook"
    description="Manage contacts on the SIM or modem storage."
    ><div class="grid">
      <div class="card span-8">
        <div class="row">
          <select class="input" aria-label="Phonebook store" bind:value={store}
            ><option value="SM">SIM phonebook</option><option value="ME">Modem phonebook</option
            ></select
          ><button class="button secondary" on:click={load}>Reload</button>
        </div>
        {#if contacts.length}<table>
            <tbody
              ><tr><th>Slot</th><th>Name</th><th>Number</th><th></th></tr
              >{#each contacts as contact (contact.index)}<tr
                  ><td>{contact.index}</td><td>{contact.name}</td><td>{contact.number}</td><td
                    ><button
                      class="button danger small"
                      on:click={() => action('phonebook/delete', { store, index: contact.index })}
                      >Delete</button
                    ></td
                  ></tr
                >{/each}</tbody
            >
          </table>{:else}<div class="empty">No contacts found.</div>{/if}
      </div>
      <div class="card span-4">
        <h3>Add contact</h3>
        <div class="stack">
          <input
            class="input"
            aria-label="Contact name"
            bind:value={name}
            placeholder="Name"
          /><input
            class="input"
            aria-label="Phone number"
            bind:value={number}
            placeholder="+880…"
          />
          <input
            class="input"
            aria-label="Phonebook slot"
            bind:value={slot}
            placeholder="First free slot"
          /><button
            class="button"
            on:click={() => action('phonebook', { store, name, number, index: slot })}
            >Save contact</button
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
          <input
            class="input"
            id={`forward-${rule.reason}`}
            value={rule.number}
            placeholder="+880…"
          />
          <div class="row">
            <button
              class="button"
              on:click={() =>
                action('forwarding', {
                  reason: rule.reason,
                  on: true,
                  number: (document.getElementById(`forward-${rule.reason}`) as HTMLInputElement)
                    .value,
                })}>Enable</button
            ><button
              class="button secondary"
              on:click={() => action('forwarding', { reason: rule.reason, on: false, number: '' })}
              >Disable</button
            >
          </div>
        </div>{/each}
    </div></Page
  >{/if}
