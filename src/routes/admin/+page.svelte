<script lang="ts">
  import { onMount } from "svelte";

  import { api } from "$lib/api";
  import { config, me } from "$lib/auth";

  let data: any = null;
  let error: string | null = null;

  onMount(async () => {
    try {
      data = await api.adminOverview();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  });

  const fmt = (ts: number | null) => (ts ? new Date(ts).toLocaleString("fr-FR") : "—");
</script>

<div class="mx-auto max-w-5xl px-4 py-6">
  <div class="flex items-center gap-3">
    <a href="/" class="text-sm text-zinc-500 hover:text-zinc-200">‹ Terminaux</a>
    <h1 class="text-lg font-semibold text-zinc-100">Administration</h1>
    {#if $config?.authMode === "dev"}
      <span class="rounded border border-yellow-900 px-1.5 text-[11px] text-yellow-300">mode dev : tout le monde est admin</span>
    {/if}
  </div>
  <p class="mt-1 text-xs text-zinc-500">
    Métadonnées uniquement : le contenu des terminaux, les dossiers et les noms personnalisés restent chiffrés.
  </p>

  {#if !$me?.user.isAdmin}
    <p class="mt-6 text-sm text-red-400">Réservé aux administrateurs.</p>
  {:else if error}
    <p class="mt-6 text-sm text-red-400">{error}</p>
  {:else if data}
    <h2 class="mt-6 text-sm font-semibold text-zinc-300">Utilisateurs ({data.users.length})</h2>
    <table class="mt-2 w-full text-left text-sm">
      <thead class="text-xs text-zinc-500"><tr><th class="py-1">Nom</th><th>Identifiant</th><th>Chiffrement</th><th>Admin</th><th>Dernière connexion</th></tr></thead>
      <tbody>
        {#each data.users as u}
          <tr class="border-t border-zinc-800"><td class="py-1.5 text-zinc-200">{u.displayName}</td><td class="font-mono text-xs">{u.username}</td><td>{u.hasVault ? "oui" : "non"}</td><td>{u.isAdmin ? "oui" : ""}</td><td class="text-xs">{fmt(u.lastLoginAt)}</td></tr>
        {/each}
      </tbody>
    </table>

    <h2 class="mt-6 text-sm font-semibold text-zinc-300">Machines ({data.machines.length})</h2>
    <table class="mt-2 w-full text-left text-sm">
      <thead class="text-xs text-zinc-500"><tr><th class="py-1">Nom</th><th>Type</th><th>Propriétaire</th><th>Accès</th><th>Vue</th></tr></thead>
      <tbody>
        {#each data.machines as m}
          <tr class="border-t border-zinc-800"><td class="py-1.5 text-zinc-200">{m.name}</td><td>{m.kind}{m.project ? ` · ${m.project}` : ""}</td><td>{m.owner}</td><td>{m.members}</td><td class="text-xs">{fmt(m.lastSeenAt)}</td></tr>
        {/each}
      </tbody>
    </table>

    <h2 class="mt-6 text-sm font-semibold text-zinc-300">Sessions sshx ({data.sessions.length})</h2>
    <table class="mt-2 w-full text-left text-sm">
      <thead class="text-xs text-zinc-500"><tr><th class="py-1">Session</th><th>Hôte</th><th>État</th><th>Terminaux</th><th>Version</th><th>Démarrée</th></tr></thead>
      <tbody>
        {#each data.sessions as s}
          <tr class="border-t border-zinc-800">
            <td class="py-1.5 font-mono text-xs text-zinc-200">{s.name}</td>
            <td>{s.hostname}</td>
            <td class:text-emerald-400={s.online} class:text-zinc-500={!s.online}>{s.online ? "en ligne" : "hors ligne"}</td>
            <td class="text-xs">{Object.entries(s.terminals).map(([k, v]) => `${v} ${k}`).join(", ") || "0"}</td>
            <td class="text-xs">{s.version}</td>
            <td class="text-xs">{fmt(s.startedAt)}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</div>
