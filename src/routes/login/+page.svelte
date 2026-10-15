<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/stores";

  import { api } from "$lib/api";
  import { config, me } from "$lib/auth";
  import { initVault } from "$lib/vault";

  let username = "";
  let busy = false;
  let error: string | null = null;

  $: providerError = $page.url.searchParams.get("error");

  async function devLogin() {
    busy = true;
    error = null;
    try {
      await api.devLogin(username);
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
  <div class="panel w-full max-w-sm p-6">
    <h1 class="text-lg font-semibold text-zinc-100">sshx platform</h1>
    <p class="mt-1 text-sm text-zinc-400">Vos terminaux, vos machines et vos agents IA, au même endroit.</p>

    {#if $config?.authMode === "oidc"}
      <a href="/api/auth/oidc/login" class="btn-primary mt-6 w-full justify-center py-2">
        Se connecter avec Microsoft
      </a>
      {#if providerError}
        <p class="mt-3 text-sm text-red-400">La connexion a échoué, réessayez.</p>
      {/if}
    {:else}
      <div class="mt-4 rounded-md border border-yellow-900/60 bg-yellow-950/40 p-2.5 text-xs text-yellow-200/90">
        Mode développement : aucune authentification. N'importe qui atteignant ce serveur peut se
        connecter sous n'importe quel nom. À réserver à un réseau privé, en attendant Entra ID.
      </div>
      <form class="mt-4 space-y-3" on:submit|preventDefault={devLogin}>
        <div>
          <label class="label" for="username">Nom d'utilisateur</label>
          <input id="username" class="input" bind:value={username} autocomplete="username" placeholder="prenom.nom" required />
        </div>
        {#if error}<p class="text-sm text-red-400">{error}</p>{/if}
        <button class="btn-primary w-full justify-center py-2" disabled={busy || !username.trim()}>Entrer</button>
      </form>
    {/if}
  </div>
</div>
