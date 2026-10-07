<script lang="ts">
  import { api } from '../lib/api';
  import { notify } from '../lib/store';
  export let configured = false;
  export let onUnlock = (): void => {};
  const title = configured ? 'Unlock profile' : 'Create your profile';
  let name = '',
    gender = 'male',
    simLabel = '',
    number = '',
    image = '',
    password = '',
    confirm = '',
    recovery = '',
    forgotMode = false,
    otpSent = false,
    otp = '',
    newPassword = '',
    confirmNew = '';
  async function unlock(): Promise<void> {
    try {
      await api('auth/login', { password });
      onUnlock();
    } catch (error) {
      notify((error as Error).message);
    }
  }
  async function create(): Promise<void> {
    if (password !== confirm) return notify('passwords do not match');
    try {
      await api('auth/setup', { name, gender, simLabel, number, password, image, recovery });
      onUnlock();
    } catch (error) {
      notify((error as Error).message);
    }
  }
  function pickImage(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => (image = String(reader.result));
    reader.readAsDataURL(file);
  }
  async function requestOtp(): Promise<void> {
    try {
      const r = await api<{ to: string }>('auth/recover/request', {});
      notify(`OTP sent to ${r.to}`);
      otpSent = true;
    } catch (error) {
      notify((error as Error).message);
    }
  }
  async function confirmRecovery(): Promise<void> {
    if (newPassword !== confirmNew) return notify('passwords do not match');
    try {
      await api('auth/recover/verify', { otp, password: newPassword });
      notify('Recovery complete — log in with the new credential');
      forgotMode = false;
      otpSent = false;
      onUnlock();
    } catch (error) {
      notify((error as Error).message);
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
        ><button class="button" on:click={unlock}>Unlock</button>
      </div>
    {:else if configured && forgotMode}
      <p class="subtle">
        An OTP will be sent from your connected SIM to the recovery number set during onboarding.
        Confirming it resets the credential; previously encrypted data is permanently removed.
      </p>
      {#if !otpSent}
        <div class="row end"><button class="button" on:click={requestOtp}>Send OTP</button></div>
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
          ><button class="button danger" on:click={confirmRecovery}>Reset & wipe archive</button>
        </div>
      {/if}
    {:else}
      <div class="label">Your name</div>
      <input class="input" bind:value={name} aria-label="Name" />
      <div class="label">Gender</div>
      <select class="input" bind:value={gender} aria-label="Gender">
        <option value="male">male</option><option value="female">female</option>
      </select>
      <div class="label">SIM label</div>
      <input class="input" bind:value={simLabel} aria-label="SIM label" />
      <div class="label">SIM number (optional)</div>
      <input class="input" bind:value={number} aria-label="SIM number" />
      <div class="label">Trusted recovery number</div>
      <input class="input" bind:value={recovery} aria-label="Recovery number" />
      <div class="label">Profile image (optional)</div>
      <input type="file" accept="image/*" on:change={pickImage} aria-label="Profile image" />
      <div class="label">Credential</div>
      <input class="input" type="password" bind:value={password} aria-label="Credential" />
      <div class="label">Confirm credential</div>
      <input class="input" type="password" bind:value={confirm} aria-label="Confirm credential" />
      <div class="row end"><button class="button" on:click={create}>Create profile</button></div>
    {/if}
  </div>
</div>

<style>
  .lockscreen {
    align-items: center;
    background: #11111b;
    display: flex;
    height: 100vh;
    justify-content: center;
    padding: 24px;
    position: fixed;
    inset: 0;
    z-index: 100;
  }
  .lockbox {
    background: #1e1e2e;
    max-width: 440px;
    width: 100%;
  }
</style>
