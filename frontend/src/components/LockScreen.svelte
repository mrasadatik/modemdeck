<script lang="ts">
  import { onDestroy } from 'svelte';
  import { api } from '../lib/api';
  import { abortScope, isAbort, notify } from '../lib/store';
  import PhoneNumberInput from './PhoneNumberInput.svelte';
  import SelectDropdown from './SelectDropdown.svelte';
  import { countryOptions } from '../lib/phone-numbers-lib.js';
  import {
    formErrors,
    loginForm,
    recoverOtpForm,
    recoverPhraseForm,
    setupForm,
    setupOtpForm,
  } from '../../../src/domain/validation/schemas.js';
  export let configured = false;
  export let onUnlock: (sessionId?: string) => void = () => {};
  let createdSessionId = '';
  const aborts = abortScope();
  onDestroy(() => aborts.abortAll());
  const title = configured ? 'Unlock profile' : 'Create your profile';
  $: recoveryCountry = recoveryCountry || country;
  $: verified = verifiedTo !== '' && verifiedTo === recoveryE164;
  // A changed number voids the previous proof.
  $: if (verifiedTo && verifiedTo !== recoveryE164) verifiedTo = '';
  let setupErrors: Record<string, string> = {};
  let setupShown = false;
  let otpError = '';
  let loginErrors: Record<string, string> = {};
  let loginShown = false;
  let phraseErrors: Record<string, string> = {};
  let phraseShown = false;
  let otpResetErrors: Record<string, string> = {};
  let otpResetShown = false;
  function validateSetup(): Record<string, string> {
    return formErrors(setupForm(recoveryCountry || country || undefined), {
      name,
      simLabel,
      recovery: recoveryE164,
      password,
      confirm,
    });
  }
  $: if (setupShown) setupErrors = validateSetup();
  $: if (loginShown) loginErrors = formErrors(loginForm(), { password });
  $: if (phraseShown)
    phraseErrors = formErrors(recoverPhraseForm(), {
      phrase,
      password: newPassword,
      confirm: confirmNew,
    });
  $: if (otpResetShown)
    otpResetErrors = formErrors(recoverOtpForm(), {
      otp,
      password: newPassword,
      confirm: confirmNew,
    });
  // Typing a new code clears the previous shape error.
  $: if (setupOtp !== undefined && otpError) otpError = '';
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
  // Single-flight per form: any running action blocks the sibling triggers.
  $: setupBusy = creating || sendingSetupOtp || verifyingSetupOtp;
  $: forgotBusy = recovering || sendingOtp || resetting;
  async function requestSetupOtp(): Promise<void> {
    if (sendingSetupOtp) return;
    if (!recoveryValid) return notify('Enter a valid recovery number first', 'error');
    sendingSetupOtp = true;
    try {
      const r = await api<{ to: string; reused?: boolean }>(
        'auth/setup/request',
        { recovery: recoveryE164, country: recoveryCountry || country },
        { signal: aborts.signal() },
      );
      otpTo = r.to;
      notify(
        r.reused ? `Code still valid — check messages on ${r.to}` : `Setup code sent to ${r.to}`,
        'ok',
      );
    } catch (error) {
      if (isAbort(error)) return;
      notify((error as Error).message, 'error');
    } finally {
      sendingSetupOtp = false;
    }
  }
  async function verifySetupOtp(): Promise<void> {
    if (verifyingSetupOtp) return;
    const shape = formErrors(setupOtpForm(), { otp: setupOtp });
    if (shape.otp) {
      otpError = shape.otp;
      return;
    }
    otpError = '';
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
  function changeNumber(): void {
    verifiedTo = '';
    setupOtp = '';
    otpError = '';
  }
  async function unlock(): Promise<void> {
    if (unlocking) return;
    loginShown = true;
    const errs = formErrors(loginForm(), { password });
    if (Object.keys(errs).length) return;
    unlocking = true;
    try {
      const r = await api<{ ok: boolean; sessionId?: string }>(
        'auth/login',
        { password },
        { signal: aborts.signal() },
      );
      onUnlock(r.sessionId);
    } catch (error) {
      if (isAbort(error)) return;
      notify((error as Error).message, 'error');
    } finally {
      unlocking = false;
    }
  }
  async function create(): Promise<void> {
    if (creating) return;
    setupShown = true;
    setupErrors = validateSetup();
    if (Object.keys(setupErrors).length) return;
    if (!verified) return notify('Verify the recovery number first', 'error');
    creating = true;
    try {
      const r = await api<{ recoveryPhrase?: string; sessionId?: string }>(
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
        createdSessionId = r.sessionId ?? '';
        return;
      }
      onUnlock(r.sessionId);
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
    onUnlock(createdSessionId || undefined);
    createdSessionId = '';
  }
  async function confirmPhrase(): Promise<void> {
    if (recovering) return;
    phraseShown = true;
    phraseErrors = formErrors(recoverPhraseForm(), {
      phrase,
      password: newPassword,
      confirm: confirmNew,
    });
    if (Object.keys(phraseErrors).length) return;
    recovering = true;
    try {
      const r = await api<{ preserved?: boolean; sessionId?: string }>(
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
      onUnlock(r.sessionId);
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
    const errs = formErrors(recoverOtpForm(), { otp, password: newPassword, confirm: confirmNew });
    if (Object.keys(errs).length) {
      otpResetErrors = errs;
      otpResetShown = true;
      return;
    }
    resetting = true;
    try {
      const r = await api<{ ok: boolean; sessionId?: string }>(
        'auth/recover/verify',
        { otp, password: newPassword },
        { signal: aborts.signal() },
      );
      notify('Recovery complete — log in with the new credential', 'ok');
      forgotMode = false;
      otpSent = false;
      onUnlock(r.sessionId);
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
      <input
        class="input"
        type="password"
        bind:value={password}
        aria-label="Credential"
        aria-invalid={loginShown && !!loginErrors.password}
      />
      {#if loginShown && loginErrors.password}<p class="field-error">{loginErrors.password}</p>{/if}
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
      <input
        class="input"
        bind:value={phrase}
        aria-label="Recovery phrase"
        aria-invalid={phraseShown && !!phraseErrors.phrase}
      />
      {#if phraseShown && phraseErrors.phrase}<p class="field-error">{phraseErrors.phrase}</p>{/if}
      <div class="label">New credential</div>
      <input
        class="input"
        type="password"
        bind:value={newPassword}
        aria-label="New credential"
        aria-invalid={phraseShown && !!phraseErrors.password}
      />
      {#if phraseShown && phraseErrors.password}<p class="field-error">
          {phraseErrors.password}
        </p>{/if}
      <div class="label">Confirm new credential</div>
      <input
        class="input"
        type="password"
        bind:value={confirmNew}
        aria-label="Confirm new credential"
        aria-invalid={phraseShown && !!(phraseErrors.confirm ?? phraseErrors._root)}
      />
      {#if phraseShown && (phraseErrors.confirm ?? phraseErrors._root)}<p class="field-error">
          {phraseErrors.confirm ?? phraseErrors._root}
        </p>{/if}
      <div class="row end">
        <button class="button" disabled={forgotBusy} on:click={confirmPhrase}
          >{recovering ? 'Recovering…' : 'Recover with phrase'}</button
        >
      </div>
      <hr style="margin:24px 0" />
      <p class="subtle">
        Alternatively, an OTP can be sent from your connected SIM to the recovery number set at
        onboarding. Confirming it resets the credential; previously encrypted data is permanently
        removed.
      </p>
      <p class="cost-note">⚠ The OTP arrives by SMS — carrier charges may apply.</p>
      {#if !otpSent}
        <div class="row end">
          <button class="button" disabled={forgotBusy} on:click={requestOtp}
            >{sendingOtp ? 'Sending…' : 'Send OTP'}</button
          >
        </div>
      {:else}
        <div class="label">OTP from recovery number</div>
        <input
          class="input"
          bind:value={otp}
          aria-label="OTP"
          aria-invalid={otpResetShown && !!otpResetErrors.otp}
          placeholder="6-digit code"
        />
        {#if otpResetShown && otpResetErrors.otp}<p class="field-error">
            {otpResetErrors.otp}
          </p>{/if}
        <div class="label">New credential</div>
        <input
          class="input"
          type="password"
          bind:value={newPassword}
          aria-label="New credential"
          aria-invalid={otpResetShown && !!otpResetErrors.password}
        />
        {#if otpResetShown && otpResetErrors.password}<p class="field-error">
            {otpResetErrors.password}
          </p>{/if}
        <div class="label">Confirm new credential</div>
        <input
          class="input"
          type="password"
          bind:value={confirmNew}
          aria-label="Confirm new credential"
          aria-invalid={otpResetShown && !!(otpResetErrors.confirm ?? otpResetErrors._root)}
        />
        {#if otpResetShown && (otpResetErrors.confirm ?? otpResetErrors._root)}<p
            class="field-error"
          >
            {otpResetErrors.confirm ?? otpResetErrors._root}
          </p>{/if}
        <div class="row between">
          <button class="button secondary small" on:click={() => (forgotMode = false)}>Back</button
          ><button class="button danger" disabled={forgotBusy} on:click={confirmRecovery}
            >{resetting ? 'Resetting…' : 'Reset & wipe archive'}</button
          >
        </div>
      {/if}
    {:else}
      <div class="label">Your name</div>
      <input
        class="input"
        bind:value={name}
        aria-label="Name"
        aria-invalid={setupShown && !!setupErrors.name}
      />
      {#if setupShown && setupErrors.name}<p class="field-error">{setupErrors.name}</p>{/if}
      <div class="label">SIM label</div>
      <input
        class="input"
        bind:value={simLabel}
        aria-label="SIM label"
        aria-invalid={setupShown && !!setupErrors.simLabel}
      />
      {#if setupShown && setupErrors.simLabel}<p class="field-error">{setupErrors.simLabel}</p>{/if}
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
        disabled={verified}
      />
      {#if setupShown && setupErrors.recovery}<p class="field-error">{setupErrors.recovery}</p>{/if}
      <p class="cost-note">⚠ The verification code arrives by SMS — carrier charges may apply.</p>
      <div class="row">
        {#if verified}
          <span class="badge ok">✓ Verified</span>
          <button class="button secondary small" on:click={changeNumber}>Change number</button>
        {:else}
          <button class="button secondary small" disabled={setupBusy} on:click={requestSetupOtp}
            >{sendingSetupOtp ? 'Sending…' : otpTo ? 'Resend code' : 'Send code'}</button
          >
          {#if otpTo}<span class="subtle">Code sent to {otpTo} — enter it below.</span>{/if}
        {/if}
      </div>
      {#if otpTo && !verified}
        <div class="label">Setup code</div>
        <div class="row">
          <input
            class="input"
            bind:value={setupOtp}
            aria-label="Setup code"
            aria-invalid={!!otpError}
            placeholder="6-digit code"
          />
          <button class="button secondary small" disabled={setupBusy} on:click={verifySetupOtp}>
            {verifyingSetupOtp ? 'Verifying…' : 'Verify'}
          </button>
        </div>
        {#if otpError}<p class="field-error">{otpError}</p>{/if}
      {/if}
      <div class="label">Credential</div>
      <input
        class="input"
        type="password"
        bind:value={password}
        aria-label="Credential"
        aria-invalid={setupShown && !!setupErrors.password}
      />
      {#if setupShown && setupErrors.password}<p class="field-error">{setupErrors.password}</p>{/if}
      <div class="label">Confirm credential</div>
      <input
        class="input"
        type="password"
        bind:value={confirm}
        aria-label="Confirm credential"
        aria-invalid={setupShown && !!(setupErrors.confirm ?? setupErrors._root)}
      />
      {#if setupShown && (setupErrors.confirm ?? setupErrors._root)}<p class="field-error">
          {setupErrors.confirm ?? setupErrors._root}
        </p>{/if}
      <div class="row end">
        <button class="button" disabled={setupBusy || !verified} on:click={create}
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
