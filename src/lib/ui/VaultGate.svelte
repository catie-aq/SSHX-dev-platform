<!-- @component Asks for the secret passphrase before showing its content. -->
<script lang="ts">
  import { api } from "$lib/api";
  import { me } from "$lib/auth";
  import { toastError } from "$lib/toast";
  import { initVault, setupVault, unlockVault, vaultStatus } from "$lib/vault";
  import { refreshDecryption } from "$lib/workspace";
  import Icon from "./Icon.svelte";
  import Logo from "./Logo.svelte";
  import Steps from "./Steps.svelte";

  const MIN_LENGTH = 10;

  let passphrase = "";
  let confirm = "";
  let remember = true;
  let reveal = false;
  let busy = false;
  let error: string | null = null;
  let showReset = false;

  async function setup() {
    if (passphrase.length < MIN_LENGTH) return (error = `Au moins ${MIN_LENGTH} caractères.`);
    if (passphrase !== confirm) return (error = "Les deux saisies sont différentes.");
    busy = true;
    error = null;
    try {
      await setupVault(passphrase, remember);
      passphrase = confirm = "";
      refreshDecryption();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      busy = false;
    }
  }

  async function unlock() {
    busy = true;
    error = null;
    try {
      if (await unlockVault(passphrase, remember)) {
        passphrase = "";
        refreshDecryption();
      } else {
        error = "Phrase incorrecte.";
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      busy = false;
    }
  }

  async function reset() {
    try {
      await api.resetVault();
      const current = await api.me();
      me.set(current);
      await initVault(current);
      showReset = false;
    } catch (err) {
      toastError(err);
    }
  }

  $: type = reveal ? "text" : "password";
</script>

{#if $vaultStatus === "unlocked"}
  <slot />
{:else if $vaultStatus === "loading"}
  <div class="flex h-dvh items-center justify-center text-sm text-zinc-500">Chargement…</div>
{:else}
  <div class="flex min-h-dvh items-center justify-center p-4">
    <div class="w-full max-w-[440px]">
      {#if $vaultStatus === "none"}
        <div class="mb-5 flex justify-center"><Steps current={2} /></div>
      {:else}
        <div class="mb-6 flex justify-center"><Logo size={40} label={false} /></div>
      {/if}
      <div class="panel p-7" data-testid="vault-gate" data-status={$vaultStatus}>
        {#if $vaultStatus === "none"}
          <h1 class="text-xl font-semibold text-zinc-50">Choisissez une phrase secrète</h1>
          <p class="mt-2 text-[15px] leading-relaxed text-zinc-400">
            Elle chiffre vos terminaux de bout en bout. Elle reste dans votre navigateur : ni le serveur ni
            personne d'autre ne peut la retrouver.
          </p>
          <form class="mt-6 space-y-4" on:submit|preventDefault={setup}>
            <div>
              <label class="label" for="pass">Phrase secrète</label>
              <div class="relative">
                <!-- svelte-ignore a11y-autofocus -->
                <input id="pass" class="input pr-10" {type} value={passphrase} on:input={(e) => (passphrase = e.currentTarget.value)} placeholder="{MIN_LENGTH} caractères minimum" autocomplete="new-password" autofocus />
                <button type="button" class="absolute inset-y-0 right-0 px-3 text-zinc-500 hover:text-zinc-200" title={reveal ? "Masquer" : "Afficher"} on:click={() => (reveal = !reveal)}>
                  <Icon name={reveal ? "eyeOff" : "eye"} size={16} />
                </button>
              </div>
              {#if passphrase && passphrase.length < MIN_LENGTH}
                <p class="mt-1 text-xs text-zinc-500">Encore {MIN_LENGTH - passphrase.length} caractère{MIN_LENGTH - passphrase.length > 1 ? "s" : ""}.</p>
              {/if}
            </div>
            <div>
              <label class="label" for="confirm">Confirmation</label>
              <input id="confirm" class="input" {type} value={confirm} on:input={(e) => (confirm = e.currentTarget.value)} autocomplete="new-password" />
            </div>
            <label class="flex items-center gap-2.5 text-sm text-zinc-300">
              <input type="checkbox" class="h-4 w-4 accent-indigo-500" bind:checked={remember} /> Rester déverrouillé sur cet appareil
            </label>
            {#if error}<p class="text-sm text-red-400">{error}</p>{/if}
            <button class="btn-primary w-full py-2.5 text-[15px]" disabled={busy}>
              {busy ? "Création des clés…" : "Continuer"}
            </button>
          </form>
          <p class="mt-5 text-xs leading-relaxed text-zinc-500">
            Notez-la : elle sera demandée sur chaque nouvel appareil. Perdue, il faudra reconnecter vos machines.
          </p>
        {:else}
          <h1 class="text-xl font-semibold text-zinc-50">Déverrouiller</h1>
          <p class="mt-2 text-[15px] text-zinc-400">Votre phrase secrète ouvre vos terminaux sur cet appareil.</p>
          <form class="mt-6 space-y-4" on:submit|preventDefault={unlock}>
            <div class="relative">
              <!-- svelte-ignore a11y-autofocus -->
              <input class="input pr-10" {type} value={passphrase} on:input={(e) => (passphrase = e.currentTarget.value)} placeholder="Phrase secrète" aria-label="Phrase secrète" autocomplete="current-password" autofocus />
              <button type="button" class="absolute inset-y-0 right-0 px-3 text-zinc-500 hover:text-zinc-200" title={reveal ? "Masquer" : "Afficher"} on:click={() => (reveal = !reveal)}>
                <Icon name={reveal ? "eyeOff" : "eye"} size={16} />
              </button>
            </div>
            <label class="flex items-center gap-2.5 text-sm text-zinc-300">
              <input type="checkbox" class="h-4 w-4 accent-indigo-500" bind:checked={remember} /> Rester déverrouillé sur cet appareil
            </label>
            {#if error}<p class="text-sm text-red-400">{error}</p>{/if}
            <button class="btn-primary w-full py-2.5 text-[15px]" disabled={busy || !passphrase}>
              {busy ? "Vérification…" : "Déverrouiller"}
            </button>
          </form>
          <button class="mt-5 text-sm text-zinc-500 underline-offset-2 hover:text-zinc-300 hover:underline" on:click={() => (showReset = !showReset)}>
            Phrase oubliée ?
          </button>
          {#if showReset}
            <div class="mt-3 rounded-lg border border-red-900/60 bg-red-950/40 p-3 text-sm text-red-200/90">
              Réinitialiser efface vos clés et les machines que vous possédez : il faudra les reconnecter. Les
              machines partagées avec vous devront vous être repartagées.
              <button class="btn-danger mt-3" on:click={reset}>Réinitialiser</button>
            </div>
          {/if}
        {/if}
      </div>
    </div>
  </div>
{/if}
