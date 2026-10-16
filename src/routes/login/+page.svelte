<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/stores";

  import { api } from "$lib/api";
  import { config, me } from "$lib/auth";
  import Logo from "$lib/ui/Logo.svelte";
  import { initVault } from "$lib/vault";

  let username = "";
  let busy = false;
  let error: string | null = null;

  $: providerError = $page.url.searchParams.get("error");

  async function devLogin() {
    busy = true;
    error = null;
    try {
      await api.devLogin(username.trim());
      const current = await api.me();
      me.set(current);
      await initVault(current);
      await goto("/");
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      busy = false;
    }
  }
</script>

<div class="flex min-h-dvh items-center justify-center p-4">
  <div class="w-full max-w-[400px]">
    <div class="mb-6 flex justify-center"><Logo size={40} /></div>
    <div class="panel p-7">
      <h1 class="text-center text-xl font-semibold text-zinc-50">Vos terminaux, partout</h1>
      <p class="mt-2 text-center text-[15px] leading-relaxed text-zinc-400">
        Les terminaux de toutes vos machines et l'état de vos agents IA, sur une seule page.
      </p>

      {#if $config?.authMode === "oidc"}
        <a href="/api/auth/oidc/login" class="btn-primary mt-7 w-full py-2.5 text-[15px]">Se connecter avec Microsoft</a>
        {#if providerError}
          <p class="mt-3 text-center text-sm text-red-400">La connexion a échoué, réessayez.</p>
        {/if}
      {:else}
        <form class="mt-7 space-y-4" on:submit|preventDefault={devLogin}>
          <div>
            <label class="label" for="username">Votre identifiant</label>
            <!-- svelte-ignore a11y-autofocus -->
            <input id="username" class="input" bind:value={username} autocomplete="username" placeholder="prenom.nom" required autofocus />
          </div>
          {#if error}<p class="text-sm text-red-400">{error}</p>{/if}
          <button class="btn-primary w-full py-2.5 text-[15px]" disabled={busy || !username.trim()}>Continuer</button>
        </form>
        <p class="mt-5 rounded-lg bg-amber-950/40 px-3 py-2 text-xs leading-relaxed text-amber-200/80">
          Mode développement, sans mot de passe : à utiliser seulement sur un réseau privé, en attendant
          la connexion Microsoft.
        </p>
      {/if}
    </div>
  </div>
</div>
