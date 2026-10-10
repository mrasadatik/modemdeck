<script lang="ts">
  import { onDestroy } from 'svelte';
  import { api, formatTime } from '../lib/api';
  import Page from './Page.svelte';
  import PhoneNumberInput from './PhoneNumberInput.svelte';
  import { abortScope, defaultCountry, isAbort, notify } from '../lib/store';
  import { confirmSent, liveState, pushSent, pushUssd, removeSent, removeSms } from '../lib/live';
  import { formErrors, smsForm, ussdForm } from '../../../src/domain/validation/schemas.js';
  export let mode: 'inbox' | 'send' | 'ussd';
  const aborts = abortScope();
  onDestroy(() => aborts.abortAll());
  let toE164 = '',
    smsCountry = '',
    clearToken = 0,
    sendErrors: Record<string, string> = {},
    sendShown = false,
    ussdErrors: Record<string, string> = {},
    ussdShown = false,
    actingPath: string | null = null,
    actingCtl: AbortController | null = null,
    sending = false,
    sendingCode = false,
    ussdCtl: AbortController | null = null,
    text = '',
    code = '',
    reply = '',
    result = 'No active session.';
  $: smsCountry = smsCountry || $defaultCountry;
  $: if (sendShown)
    sendErrors = formErrors(smsForm(smsCountry || $defaultCountry || undefined), {
      to: toE164,
      text,
    });
  $: if (ussdShown) ussdErrors = formErrors(ussdForm(), { code: code || reply });
  $: acting = actingPath !== null;
  // Single-flight within the view: any running action blocks the other triggers.
  $: viewBusy = acting || sending || sendingCode;
  $: recentNumbers = [
    ...new Set([
      ...$liveState.sent.map((message) => message.to),
      ...$liveState.sms.map((message) => message.from),
      ...$liveState.calls.map((call) => call.number),
    ]),
  ]
    .filter((number) => number && number !== 'Unknown')
    .slice(0, 30);
  $: recentCodes = [...new Set($liveState.ussd.map((item) => item.code))].slice(0, 20);
  async function action(
    path: string,
    body: Record<string, unknown> = {},
    cancellable = false,
  ): Promise<boolean> {
    if (actingPath) return false;
    actingPath = path;
    let controller: AbortController | null = null;
    let signal: AbortSignal;
    if (cancellable) {
      controller = new AbortController();
      actingCtl = controller;
      signal = controller.signal;
    } else {
      signal = aborts.signal();
    }
    try {
      await api(path, body, { signal });
      notify('Done', 'ok');
      return true;
    } catch (error) {
      if (isAbort(error)) notify('Cancelled');
      else notify((error as Error).message, 'error');
      return false;
    } finally {
      if (actingPath === path) actingPath = null;
      if (controller && actingCtl === controller) actingCtl = null;
    }
  }
  function cancelAction(): void {
    actingCtl?.abort();
  }
  async function syncModem(): Promise<void> {
    if (actingPath) return;
    actingPath = 'sync';
    const controller = new AbortController();
    actingCtl = controller;
    try {
      const result = await api<{ imported: number; perStore?: Record<string, number> }>(
        'sync',
        {},
        { signal: controller.signal },
      );
      const perStore = Object.entries(result.perStore ?? {})
        .map(([store, count]) => `${store}: ${count}`)
        .join(', ');
      notify(
        result.imported > 0
          ? `Synced · ${result.imported} new (${perStore})`
          : 'Already up to date',
        'ok',
      );
    } catch (error) {
      if (isAbort(error)) notify('Cancelled');
      else notify((error as Error).message, 'error');
    } finally {
      if (actingPath === 'sync') actingPath = null;
      if (actingCtl === controller) actingCtl = null;
    }
  }
  async function removeMessage(id: string): Promise<void> {
    if (await action('sms/delete', { id })) removeSms(id);
  }
  async function send(): Promise<void> {
    if (sending) return;
    sendShown = true;
    sendErrors = formErrors(smsForm(smsCountry || $defaultCountry || undefined), {
      to: toE164,
      text,
    });
    if (Object.keys(sendErrors).length) return;
    if (!confirm('Send this SMS? Your carrier may charge for it.')) return;
    sending = true;
    // Optimistic: the entry appears instantly, confirmed (or rolled back) below.
    const clientTs = new Date().toISOString();
    const draft = { to: toE164, text, ts: clientTs, parts: 1, pending: true };
    pushSent(draft);
    toE164 = '';
    clearToken += 1;
    text = '';
    try {
      const sent = await api<{ to: string; text: string; ts: string; parts: number }>(
        'sms',
        { to: draft.to, text: draft.text },
        { signal: aborts.signal() },
      );
      confirmSent(clientTs, { ...sent, pending: false });
      notify(`Sent · ${sent.parts} part(s)`, 'ok');
    } catch (error) {
      if (isAbort(error)) {
        removeSent(clientTs);
        return;
      }
      removeSent(clientTs);
      notify((error as Error).message, 'error');
    } finally {
      sending = false;
    }
  }
  async function ussd(): Promise<void> {
    if (sendingCode) return;
    ussdShown = true;
    ussdErrors = formErrors(ussdForm(), { code: code || reply });
    if (Object.keys(ussdErrors).length) return;
    sendingCode = true;
    const controller = new AbortController();
    ussdCtl = controller;
    const requestCode = code || reply;
    result = 'Sending…';
    try {
      const value = await api<{ text: string; more: boolean; status: number }>(
        'ussd',
        { code: requestCode },
        { signal: controller.signal },
      );
      pushUssd({
        code: requestCode,
        text: value.text,
        more: value.more,
        status: value.status ?? 0,
        ts: new Date().toISOString(),
      });
      result = value.text + (value.more ? '\n\nReply required' : '');
      code = '';
      reply = '';
    } catch (error) {
      result = isAbort(error) ? 'Cancelled.' : `⚠ ${(error as Error).message}`;
    } finally {
      if (ussdCtl === controller) ussdCtl = null;
      sendingCode = false;
    }
  }
  async function cancelUssd(): Promise<void> {
    if (sendingCode) {
      // Abort the start request, then release the modem-side session.
      ussdCtl?.abort();
      try {
        await api('ussd/cancel', {}, { signal: aborts.signal() });
      } catch {
        /* start teardown already handles feedback */
      }
      return;
    }
    await action('ussd/cancel');
  }
</script>

{#if mode === 'inbox'}<Page
    eyebrow="Messages"
    title="Inbox"
    description="Messages received by your modem."
    ><svelte:fragment slot="actions"
      ><button
        class="button secondary"
        disabled={viewBusy && actingPath !== 'sync'}
        on:click={() => (actingPath === 'sync' ? cancelAction() : syncModem())}
        >{actingPath === 'sync' ? 'Cancel' : '↻ Sync modem'}</button
      ><button
        class="button danger"
        disabled={viewBusy && actingPath !== 'purge'}
        on:click={() =>
          actingPath === 'purge'
            ? cancelAction()
            : confirm('Delete all messages from the modem?') && action('purge', {}, true)}
        >{actingPath === 'purge' ? 'Cancel' : 'Clear modem'}</button
      ></svelte:fragment
    >
    <div class="card">
      {#each $liveState.sms as message (message.id)}<div class="message">
          <div class="row between">
            <b>{message.from}</b><span class="subtle">{formatTime(message.ts)}</span>
          </div>
          <div class="message-text">{message.text}</div>
          <button
            class="button secondary small"
            disabled={viewBusy}
            on:click={() => removeMessage(message.id)}>Remove from archive</button
          >
        </div>{:else}<div class="empty">No messages yet.</div>{/each}
    </div></Page
  >
{:else if mode === 'send'}<Page
    eyebrow="Messages"
    title="Send a message"
    description="Unicode and international numbers are supported."
    ><div class="grid">
      <div class="card span-8">
        <div class="label">Recipient</div>
        <PhoneNumberInput
          bind:country={smsCountry}
          defaultCountry={$defaultCountry}
          bind:e164={toE164}
          label="Destination number"
          datalistId="recent-numbers"
          {clearToken}
        />
        {#if sendShown && sendErrors.to}<p class="field-error">{sendErrors.to}</p>{/if}
        <datalist id="recent-numbers">
          {#each recentNumbers as number (number)}<option value={number}></option>{/each}
        </datalist>
        <div class="label">Message <span class="muted">{text.length} characters</span></div>
        <textarea
          rows="7"
          bind:value={text}
          placeholder="Write your message…"
          aria-invalid={sendShown && !!sendErrors.text}></textarea>
        {#if sendShown && sendErrors.text}<p class="field-error">{sendErrors.text}</p>{/if}
        <p class="cost-note">⚠ Sending SMS may incur carrier charges.</p>
        <div class="row end">
          <button class="button" disabled={viewBusy} on:click={send}
            >{sending ? 'Sending…' : 'Send message'}</button
          >
        </div>
      </div>
      <div class="card span-4">
        <h3>Sent recently</h3>
        {#each $liveState.sent as message (message.ts + message.to)}<div class="message">
            <b>{message.to}</b>
            <div class="subtle">
              {formatTime(message.ts)} · {message.parts} part(s){message.pending
                ? ' · sending…'
                : ''}
            </div>
            <div class="message-text">{message.text}</div>
          </div>{:else}<div class="empty">No sent messages.</div>{/each}
      </div>
    </div></Page
  >
{:else}<Page
    eyebrow="Network tools"
    title="USSD"
    description="Check balances, activate packs, and use carrier services."
    ><div class="grid">
      <div class="card span-8">
        <div class="label">USSD code</div>
        <div class="row">
          <input
            class="input"
            aria-label="USSD code"
            aria-invalid={ussdShown && !!ussdErrors.code}
            bind:value={code}
            list="recent-ussd-codes"
            placeholder="*121#"
          /><datalist id="recent-ussd-codes">
            {#each recentCodes as recentCode (recentCode)}<option value={recentCode}
              ></option>{/each}
          </datalist><button class="button" disabled={viewBusy} on:click={ussd}
            >{sendingCode ? 'Sending…' : 'Send code'}</button
          >
        </div>
        {#if ussdShown && ussdErrors.code}<p class="field-error">{ussdErrors.code}</p>{/if}
        <p class="cost-note">⚠ Carrier charges may apply to USSD sessions.</p>
        <div class="notice">{result}</div>
        <div class="row">
          <input
            class="input"
            aria-label="USSD reply"
            bind:value={reply}
            placeholder="Reply, e.g. 1"
          /><button class="button secondary" disabled={viewBusy} on:click={ussd}>Reply</button
          ><button class="button danger" disabled={viewBusy && !sendingCode} on:click={cancelUssd}
            >{sendingCode ? 'Cancel request' : 'Cancel'}</button
          >
        </div>
      </div>
      <div class="card span-4">
        <h3>Recent requests</h3>
        {#each $liveState.ussd as item (item.ts + item.code)}<div class="message">
            <b>{item.code}</b>
            <div class="subtle">{formatTime(item.ts)}</div>
            <div class="message-text">{item.text}</div>
          </div>{/each}
      </div>
    </div></Page
  >{/if}
