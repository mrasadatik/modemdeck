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
    confirm = '';
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
      await api('auth/setup', { name, gender, simLabel, number, password, image });
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
</script>

<div class="lockscreen" role="dialog" aria-label={title}>
  <div class="lockbox card">
    <div class="eyebrow">ModemDeck</div>
    <h2>{title}</h2>
    <p class="subtle">
      This console is bound to the connected SIM. Enter your credential to continue.
    </p>
    {#if configured}
      <div class="label">Credential</div>
      <input class="input" type="password" bind:value={password} aria-label="Credential" />
      <div class="row end"><button class="button" on:click={unlock}>Unlock</button></div>
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
