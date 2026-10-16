<script lang="ts">
  import { onMount } from "svelte";

  import { api } from "$lib/api";
  import { config, me } from "$lib/auth";
  import Icon from "$lib/ui/Icon.svelte";

  let data: any = null;
  let error: string | null = null;

  onMount(async () => {
    try {
      data = await api.adminOverview();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  });

  const fmt = (ts: number | null) => (ts ? new Date(ts).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }) : "—");
</script>

<div class="mx-auto max-w-5xl px-4 py-6 sm:py-10">
  <a href="/" class="btn-ghost -ml-2.5"><Icon name="chevronLeft" size={16} /> Terminaux</a>
  <div class="mt-3 flex flex-wrap items-center gap-3">
    <h1 class="text-2xl font-semibold text-zinc-50">Administration</h1>
    {#if $config?.authMode === "dev"}
      <span class="rounded-md bg-amber-950/60 px-2 py-0.5 text-xs text-amber-200">mode dev : tout le monde est admin</span>
    {/if}
  </div>
  <p class="mt-2 text-[15px] text-zinc-400">
    Métadonnées uniquement : le contenu des terminaux, les dossiers et les noms des terminaux restent chiffrés.
  </p>

  {#if !$me?.user.isAdmin}
    <p class="mt-6 text-[15px] text-red-400">Réservé aux administrateurs.</p>
  {:else if error}
    <p class="mt-6 text-[15px] text-red-400">{error}</p>
  {:else if data}
    {#each [
      { title: "Utilisateurs", rows: data.users, kind: "users" },
      { title: "Machines", rows: data.machines, kind: "machines" },
      { title: "Sessions sshx", rows: data.sessions, kind: "sessions" },
    ] as section}
      <section class="panel mt-6 overflow-x-auto" data-testid="admin-{section.kind}">
        <h2 class="border-b border-zinc-800 px-5 py-3 text-[15px] font-semibold text-zinc-100">
          {section.title} <span class="font-normal text-zinc-500">{section.rows.length}</span>
        </h2>
        <table class="w-full text-left text-sm">
          <thead class="text-xs text-zinc-500">
            {#if section.kind === "users"}
              <tr><th class="px-5 py-2 font-medium">Nom</th><th class="font-medium">Identifiant</th><th class="font-medium">Phrase secrète</th><th class="font-medium">Admin</th><th class="pr-5 font-medium">Dernière connexion</th></tr>
            {:else if section.kind === "machines"}
              <tr><th class="px-5 py-2 font-medium">Nom</th><th class="font-medium">Type</th><th class="font-medium">Propriétaire</th><th class="font-medium">Accès</th><th class="pr-5 font-medium">Vue</th></tr>
            {:else}
              <tr><th class="px-5 py-2 font-medium">Session</th><th class="font-medium">Hôte</th><th class="font-medium">État</th><th class="font-medium">Terminaux</th><th class="font-medium">Version</th><th class="pr-5 font-medium">Démarrée</th></tr>
            {/if}
          </thead>
          <tbody class="text-zinc-300">
            {#each section.rows as r}
              <tr class="border-t border-zinc-800/70">
                {#if section.kind === "users"}
                  <td class="px-5 py-2.5 text-zinc-100">{r.displayName}</td><td class="font-mono text-[13px]">{r.username}</td><td>{r.hasVault ? "oui" : "non"}</td><td>{r.isAdmin ? "oui" : ""}</td><td class="pr-5">{fmt(r.lastLoginAt)}</td>
                {:else if section.kind === "machines"}
                  <td class="px-5 py-2.5 text-zinc-100">{r.name}</td><td>{r.kind === "project" ? "projet" : "personnelle"}{r.project ? ` · ${r.project}` : ""}</td><td>{r.owner}</td><td>{r.members}</td><td class="pr-5">{fmt(r.lastSeenAt)}</td>
                {:else}
                  <td class="px-5 py-2.5 font-mono text-[13px] text-zinc-100">{r.name}</td>
                  <td>{r.hostname}</td>
                  <td class:text-emerald-400={r.online} class:text-zinc-500={!r.online}>{r.online ? "en ligne" : "hors ligne"}</td>
                  <td>{Object.entries(r.terminals).map(([k, v]) => `${v} ${k}`).join(", ") || "0"}</td>
                  <td>{r.version}</td>
                  <td class="pr-5">{fmt(r.startedAt)}</td>
                {/if}
              </tr>
            {/each}
          </tbody>
        </table>
      </section>
    {/each}
  {/if}
</div>
