<script lang="ts">
  import { onDestroy } from 'svelte';
  import { api } from '../lib/api';
  import { abortScope, isAbort, notify } from '../lib/store';
  import PhoneNumberInput from './PhoneNumberInput.svelte';
  import SelectDropdown from './SelectDropdown.svelte';
  import { countryOptions } from '../lib/phone-numbers-lib.js';
  export let configured = false;
  export let onUnlock = (): void => {};
  const aborts = abortScope();
  onDestroy(() => aborts.abortAll());
  const title = configured ? 'Unlock profile' : 'Create your profile';
  $: recoveryCountry = recoveryCountry || country;
  $: verified = verifiedTo !== '' && verifiedTo === recoveryE164;
  // A changed number voids the previous proof.
  $: if (verifiedTo && verifiedTo !== recoveryE164) verifiedTo = '';
  let name = '',
    simLabel = '',
    country = '',
    password = '',
    confirm = '',
    recoveryE164 = '',
    recoveryValid = false,
    recoveryCountry = '',
    setupOtp = '',
    otpTo = '',
    verifiedTo = '',
    forgotMode = false,
    otpSent = false,
    otp = '',
    newPassword = '',
    confirmNew = '',
    phrase = '',
    phraseResult = '';
  let unlocking = false,
    creating = false,
    recovering = false,
    sendingOtp = false,
    resetting = false,
    sendingSetupOtp = false,
    verifyingSetupOtp = false;
  async function requestSetupOtp(): Promise<void> {
    if (sendingSetupOtp) return;
    if (!recoveryValid) return notify('Enter a valid recovery number first', 'error');
    sendingSetupOtp = true;
    try {
      const r = await api<{ to: string }>(
        'auth/setup/request',
        { recovery: recoveryE164, country: recoveryCountry || country },
        { signal: aborts.signal() },
      );
      otpTo = r.to;
      notify(`Setup code sent to ${r.to}`, 'ok');
    } catch (error) {
      if (isAbort(error)) return;
      notify((error as Error).message, 'error');
    } finally {
      sendingSetupOtp = false;
    }
  }
  async function verifySetupOtp(): Promise<void> {
    if (verifyingSetupOtp) return;
    verifyingSetupOtp = true;
    try {
      await api('auth/setup/verify', { otp: setupOtp }, { signal: aborts.signal() });
      verifiedTo = recoveryE164;
      notify('Recovery number verified', 'ok');
    } catch (error) {
      if (isAbort(error)) return;
      notify((error as Error).message, 'error');
    } finally {
      verifyingSetupOtp = false;
    }
  }
  async function unlock(): Promise<void> {
    if (unlocking) return;
    unlocking = true;
    try {
      await api('auth/login', { password }, { signal: aborts.signal() });
      onUnlock();
    } catch (error) {
      if (isAbort(error)) return;
      notify((error as Error).message, 'error');
    } finally {
      unlocking = false;
    }
  }
  async function create(): Promise<void> {
    if (creating) return;
    if (password !== confirm) return notify('passwords do not match', 'error');
    if (!verified) return notify('Verify the recovery number first', 'error');
    creating = true;
    try {
      const r = await api<{ recoveryPhrase?: string }>(
        'auth/setup',
        {
          name,
          simLabel,
          country,
          password,
          recovery: recoveryE164,
        },
        { signal: aborts.signal() },
      );
      if (r.recoveryPhrase) {
        phraseResult = r.recoveryPhrase;
        return;
      }
      onUnlock();
    } catch (error) {
      if (isAbort(error)) return;
      notify((error as Error).message, 'error');
    } finally {
      creating = false;
    }
  }
  function finishRecoverySave(): void {
    notify('Recovery phrase saved — welcome back', 'ok');
    phraseResult = '';
    onUnlock();
  }
  async function confirmPhrase(): Promise<void> {
    if (recovering) return;
    if (newPassword !== confirmNew) return notify('passwords do not match', 'error');
    recovering = true;
    try {
      const r = await api<{ preserved?: boolean }>(
        'auth/recover/phrase',
        {
          phrase,
          password: newPassword,
        },
        { signal: aborts.signal() },
      );
      notify(r.preserved ? 'Archive preserved — credential updated' : 'Credential updated', 'ok');
      forgotMode = false;
      otpSent = false;
      onUnlock();
    } catch (error) {
      if (isAbort(error)) return;
      notify((error as Error).message, 'error');
    } finally {
      recovering = false;
    }
  }
  async function requestOtp(): Promise<void> {
    if (sendingOtp) return;
    sendingOtp = true;
    try {
      const r = await api<{ to: string }>('auth/recover/request', {}, { signal: aborts.signal() });
      notify(`OTP sent to ${r.to}`, 'ok');
      otpSent = true;
    } catch (error) {
      if (isAbort(error)) return;
      notify((error as Error).message, 'error');
    } finally {
      sendingOtp = false;
    }
  }
  async function confirmRecovery(): Promise<void> {
    if (resetting) return;
    if (newPassword !== confirmNew) return notify('passwords do not match', 'error');
    resetting = true;
    try {
      await api('auth/recover/verify', { otp, password: newPassword }, { signal: aborts.signal() });
      notify('Recovery complete — log in with the new credential', 'ok');
      forgotMode = false;
      otpSent = false;
      onUnlock();
    } catch (error) {
      if (isAbort(error)) return;
      notify((error as Error).message, 'error');
    } finally {
      resetting = false;
    }
  }
</script>

<div class="lockscreen" role="dialog" aria-label={title}>
  <div class="lockbox card">
    <div class="eyebrow">ModemDeck</div>
    <h2>{title}</h2>
    <p class="subtle">
      This console is bound to the connected SIM. Enter your credential to continue.
    </p>
    {#if configured && !forgotMode}
      <div class="label">Credential</div>
      <input class="input" type="password" bind:value={password} aria-label="Credential" />
      <div class="row between">
        <button class="button secondary small" on:click={() => (forgotMode = true)}
          >Forgot credential?</button
        ><button class="button" disabled={unlocking} on:click={unlock}
          >{unlocking ? 'Unlocking…' : 'Unlock'}</button
        >
      </div>
    {:else if configured && forgotMode}
      <div class="row between">
        <button class="button secondary small" on:click={() => (forgotMode = false)}>Back</button>
      </div>
      <div class="label">Use recovery phrase</div>
      <input class="input" bind:value={phrase} aria-label="Recovery phrase" />
      <div class="label">New credential</div>
      <input class="input" type="password" bind:value={newPassword} aria-label="New credential" />
      <div class="label">Confirm new credential</div>
      <input
        class="input"
        type="password"
        bind:value={confirmNew}
        aria-label="Confirm new credential"
      />
      <div class="row end">
        <button class="button" disabled={recovering} on:click={confirmPhrase}
          >{recovering ? 'Recovering…' : 'Recover with phrase'}</button
        >
      </div>
      <hr style="margin:24px 0" />
      <p class="subtle">
        Alternatively, an OTP can be sent from your connected SIM to the recovery number set at
        onboarding. Confirming it resets the credential; previously encrypted data is permanently
        removed.
      </p>
      {#if !otpSent}
        <div class="row end">
          <button class="button" disabled={sendingOtp} on:click={requestOtp}
            >{sendingOtp ? 'Sending…' : 'Send OTP'}</button
          >
        </div>
      {:else}
        <div class="label">OTP from recovery number</div>
        <input class="input" bind:value={otp} aria-label="OTP" />
        <div class="label">New credential</div>
        <input class="input" type="password" bind:value={newPassword} aria-label="New credential" />
        <div class="label">Confirm new credential</div>
        <input
          class="input"
          type="password"
          bind:value={confirmNew}
          aria-label="Confirm new credential"
        />
        <div class="row between">
          <button class="button secondary small" on:click={() => (forgotMode = false)}>Back</button
          ><button class="button danger" disabled={resetting} on:click={confirmRecovery}
            >{resetting ? 'Resetting…' : 'Reset & wipe archive'}</button
          >
        </div>
      {/if}
    {:else}
      <div class="label">Your name</div>
      <input class="input" bind:value={name} aria-label="Name" />
      <div class="label">SIM label</div>
      <input class="input" bind:value={simLabel} aria-label="SIM label" />
      <div class="label">Default country</div>
      <SelectDropdown
        bind:value={country}
        options={countryOptions('None — require full international format')}
        label="Default country"
        searchPlaceholder="Search country…"
      />
      <div class="label">Trusted recovery number (required)</div>
      <PhoneNumberInput
        bind:country={recoveryCountry}
        defaultCountry={country}
        bind:e164={recoveryE164}
        bind:valid={recoveryValid}
        label="Recovery number"
        allowEmpty={false}
      />
      <div class="row">
        <button class="button secondary small" disabled={sendingSetupOtp} on:click={requestSetupOtp}
          >{sendingSetupOtp ? 'Sending…' : otpTo ? 'Resend code' : 'Send code'}</button
        >
        {#if verified}<span class="badge ok">✓ Verified</span>
        {:else if otpTo}<span class="subtle">Code sent to {otpTo} — enter it below.</span>{/if}
      </div>
      {#if otpTo && !verified}
        <div class="label">Setup code</div>
        <div class="row">
          <input
            class="input"
            bind:value={setupOtp}
            aria-label="Setup code"
            placeholder="6-digit code"
          />
          <button
            class="button secondary small"
            disabled={verifyingSetupOtp}
            on:click={verifySetupOtp}
          >
            {verifyingSetupOtp ? 'Verifying…' : 'Verify'}
          </button>
        </div>
      {/if}
      <div class="label">Credential</div>
      <input class="input" type="password" bind:value={password} aria-label="Credential" />
      <div class="label">Confirm credential</div>
      <input class="input" type="password" bind:value={confirm} aria-label="Confirm credential" />
      <div class="row end">
        <button class="button" disabled={creating || !verified} on:click={create}
          >{creating ? 'Creating…' : 'Create profile'}</button
        >
      </div>
      {#if phraseResult}
        <div class="notice" style="margin-top:16px; word-break: break-all;">
          <strong
            >Write this recovery phrase down safely — it is the only way to recover without wiping
            data:</strong
          ><br />
          <code>{phraseResult}</code>
        </div>
        <div class="row end" style="margin-top:12px">
          <button class="button" on:click={finishRecoverySave}>I have saved it — continue</button>
        </div>
      {/if}
    {/if}
  </div>
</div>

<style>
  .lockscreen {
    align-items: center;
    background: #11111b;
    display: flex;
    height: 100vh;
    height: 100dvh;
    justify-content: center;
    overflow-y: auto;
    padding: 24px;
    position: fixed;
    inset: 0;
    z-index: 100;
  }
  .lockbox {
    background: #1e1e2e;
    margin: auto;
    max-height: calc(100dvh - 48px);
    max-width: 440px;
    overflow-y: auto;
    width: 100%;
  }
</style>
