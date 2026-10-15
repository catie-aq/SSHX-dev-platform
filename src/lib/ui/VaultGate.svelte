<!-- @component Asks for the encryption passphrase before showing its content. -->
<script lang="ts">
  import { api } from "$lib/api";
  import { me } from "$lib/auth";
  import { toastError } from "$lib/toast";
  import { initVault, setupVault, unlockVault, vaultStatus } from "$lib/vault";
  import { refreshDecryption } from "$lib/workspace";

  let passphrase = "";
  let confirm = "";
  let remember = true;
  let busy = false;
  let error: string | null = null;
  let showReset = false;

  async function setup() {
    if (passphrase.length < 10) return (error = "Au moins 10 caractères.");
    if (passphrase !== confirm) return (error = "Les deux saisies diffèrent.");
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
</script>

{#if $vaultStatus === "unlocked"}
  <slot />
{:else if $vaultStatus === "loading"}
  <div class="flex h-full items-center justify-center text-sm text-zinc-500">Chargement…</div>
{:else}
  <div class="flex min-h-full items-center justify-center p-4">
    <div class="panel w-full max-w-md p-6">
      {#if $vaultStatus === "none"}
        <h2 class="text-base font-semibold text-zinc-100">Phrase de chiffrement</h2>
        <p class="mt-2 text-sm text-zinc-400">
          Les terminaux restent chiffrés de bout en bout. Cette phrase protège les clés de vos machines ;
          elle ne quitte jamais votre navigateur et le serveur ne peut pas la retrouver. Si vous la perdez,
          il faudra réenrôler vos machines.
        </p>
        <form class="mt-4 space-y-3" on:submit|preventDefault={setup}>
          <input class="input" type="password" bind:value={passphrase} placeholder="Phrase (10 caractères minimum)" autocomplete="new-password" />
          <input class="input" type="password" bind:value={confirm} placeholder="Confirmation" autocomplete="new-password" />
          <label class="flex items-center gap-2 text-sm text-zinc-400">
            <input type="checkbox" bind:checked={remember} /> Se souvenir sur cet appareil
          </label>
          {#if error}<p class="text-sm text-red-400">{error}</p>{/if}
          <button class="btn-primary w-full justify-center py-2" disabled={busy}>
            {busy ? "Dérivation de la clé…" : "Créer"}
          </button>
        </form>
      {:else}
        <h2 class="text-base font-semibold text-zinc-100">Déverrouiller</h2>
        <p class="mt-2 text-sm text-zinc-400">Saisissez votre phrase de chiffrement pour ouvrir vos terminaux.</p>
        <form class="mt-4 space-y-3" on:submit|preventDefault={unlock}>
          <!-- svelte-ignore a11y-autofocus -->
          <input class="input" type="password" bind:value={passphrase} placeholder="Phrase de chiffrement" autocomplete="current-password" autofocus />
          <label class="flex items-center gap-2 text-sm text-zinc-400">
            <input type="checkbox" bind:checked={remember} /> Se souvenir sur cet appareil
          </label>
          {#if error}<p class="text-sm text-red-400">{error}</p>{/if}
          <button class="btn-primary w-full justify-center py-2" disabled={busy || !passphrase}>
            {busy ? "Vérification…" : "Déverrouiller"}
          </button>
        </form>
        <button class="mt-4 text-xs text-zinc-500 underline hover:text-zinc-300" on:click={() => (showReset = !showReset)}>
          Phrase oubliée ?
        </button>
        {#if showReset}
          <div class="mt-2 rounded-md border border-red-900/60 bg-red-950/40 p-3 text-xs text-red-200/90">
            Réinitialiser supprime vos clés et les machines que vous possédez : il faudra les réenrôler avec
            de nouveaux jetons. Les machines partagées avec vous devront vous être repartagées.
            <button class="btn-danger mt-2" on:click={reset}>Réinitialiser le chiffrement</button>
          </div>
        {/if}
      {/if}
    </div>
  </div>
{/if}
