<script lang="ts">
  import { onMount } from "svelte";

  import { api, type Machine, type UserInfo } from "$lib/api";
  import { me } from "$lib/auth";
  import { fingerprint } from "$lib/crypto";
  import { toast, toastError } from "$lib/toast";
  import VaultGate from "$lib/ui/VaultGate.svelte";
  import { composeToken, machineKeyRaw, newMachineKey, shareMachineKey, vaultStatus } from "$lib/vault";
  import { loadWorkspace, machines, sessions } from "$lib/workspace";

  let name = "";
  let kind: "personal" | "project" = "personal";
  let project = "";
  let busy = false;
  let shown: { machine: string; token: string } | null = null;
  let users: UserInfo[] = [];
  let shareTarget: Record<string, string> = {};
  let fingerprints: Record<string, string> = {};
  let editing: string | null = null;
  let edit = { name: "", kind: "personal" as "personal" | "project", project: "" };

  $: list = [...$machines.values()].sort((a, b) => a.name.localeCompare(b.name));
  $: origin = typeof window !== "undefined" ? window.location.origin : "";

  async function refresh() {
    await loadWorkspace();
    users = await api.users();
    for (const u of users) {
      if (u.publicKey && !fingerprints[u.id]) fingerprints[u.id] = await fingerprint(JSON.parse(u.publicKey));
    }
  }

  onMount(() => {
    const unsub = vaultStatus.subscribe((s) => {
      if (s === "unlocked") refresh().catch(toastError);
    });
    return unsub;
  });

  async function create() {
    busy = true;
    try {
      const id = crypto.randomUUID();
      const { raw, keyEnc } = await newMachineKey(id);
      const res = await api.createMachine({
        id,
        name: name.trim(),
        kind,
        project: kind === "project" ? project.trim() || null : null,
        keyEnc,
      });
      shown = { machine: name.trim(), token: composeToken(res.token, raw) };
      name = project = "";
      await refresh();
    } catch (err) {
      toastError(err);
    } finally {
      busy = false;
    }
  }

  async function rotate(m: Machine) {
    try {
      const res = await api.rotateToken(m.id);
      shown = { machine: m.name, token: composeToken(res.token, await machineKeyRaw(m)) };
      toast("Ancien jeton révoqué. Réenrôlez la machine avec le nouveau.", "info", 6000);
    } catch (err) {
      toastError(err);
    }
  }

  async function remove(m: Machine) {
    if (!confirm(`Supprimer « ${m.name} » ? Son jeton est révoqué et ses sessions disparaissent.`)) return;
    try {
      await api.deleteMachine(m.id);
      await refresh();
    } catch (err) {
      toastError(err);
    }
  }

  async function share(m: Machine) {
    const user = users.find((u) => u.id === shareTarget[m.id]);
    if (!user) return;
    try {
      await api.addMember(m.id, user.id, await shareMachineKey(m, user));
      shareTarget[m.id] = "";
      toast(`${m.name} partagée avec ${user.displayName}.`, "success");
      await refresh();
    } catch (err) {
      toastError(err);
    }
  }

  async function unshare(m: Machine, userId: string) {
    try {
      await api.removeMember(m.id, userId);
      await refresh();
    } catch (err) {
      toastError(err);
    }
  }

  function startEdit(m: Machine) {
    editing = m.id;
    edit = { name: m.name, kind: m.kind, project: m.project ?? "" };
  }

  async function saveEdit(m: Machine) {
    try {
      await api.updateMachine(m.id, {
        name: edit.name.trim(),
        kind: edit.kind,
        project: edit.kind === "project" ? edit.project.trim() || null : null,
      });
      editing = null;
      await refresh();
    } catch (err) {
      toastError(err);
    }
  }

  function onlineSessions(m: Machine) {
    return [...$sessions.values()].filter((s) => s.machineId === m.id && s.online).length;
  }

  function ago(ts: number | null): string {
    if (!ts) return "jamais vue";
    const s = Math.round((Date.now() - ts) / 1000);
    if (s < 60) return "à l'instant";
    if (s < 3600) return `il y a ${Math.round(s / 60)} min`;
    if (s < 86400) return `il y a ${Math.round(s / 3600)} h`;
    return `il y a ${Math.round(s / 86400)} j`;
  }

  async function copy(text: string) {
    await navigator.clipboard.writeText(text);
    toast("Copié", "success", 1500);
  }
</script>

<VaultGate>
  <div class="mx-auto max-w-3xl px-4 py-6">
    <div class="flex items-center gap-3">
      <a href="/" class="text-sm text-zinc-500 hover:text-zinc-200">‹ Terminaux</a>
      <h1 class="text-lg font-semibold text-zinc-100">Machines</h1>
    </div>

    <form class="panel mt-5 grid gap-3 p-4 sm:grid-cols-[1fr_auto_1fr_auto] sm:items-end" on:submit|preventDefault={create}>
      <div>
        <label class="label" for="m-name">Nom</label>
        <input id="m-name" class="input" bind:value={name} placeholder="gpu-traduction, portable…" required />
      </div>
      <div>
        <label class="label" for="m-kind">Type</label>
        <select id="m-kind" class="input" bind:value={kind}>
          <option value="personal">Personnelle</option>
          <option value="project">Projet</option>
        </select>
      </div>
      <div>
        <label class="label" for="m-project">Projet</label>
        <input id="m-project" class="input" bind:value={project} placeholder="traduction" disabled={kind !== "project"} />
      </div>
      <button class="btn-primary justify-center py-1.5" disabled={busy || !name.trim()}>Créer un jeton</button>
    </form>

    {#if shown}
      <div class="panel mt-4 border-indigo-500/60 p-4">
        <div class="flex items-center justify-between">
          <h2 class="text-sm font-semibold text-zinc-100">Jeton de « {shown.machine} »</h2>
          <button class="text-xs text-zinc-500 hover:text-zinc-200" on:click={() => (shown = null)}>Masquer</button>
        </div>
        <p class="mt-1 text-xs text-zinc-400">
          Affiché une seule fois. La partie après le point est la clé de la machine : elle ne passe jamais par le
          serveur. Sur la machine :
        </p>
        {#each [
          `sshx platform enroll ${origin} ${shown.token}`,
          "sshx claude-hooks install",
          "sshx",
        ] as cmd}
          <div class="mt-2 flex items-center gap-2">
            <code class="flex-1 overflow-x-auto whitespace-nowrap rounded bg-zinc-900 px-2 py-1.5 font-mono text-xs text-zinc-200">{cmd}</code>
            <button class="btn px-2 py-1 text-xs" on:click={() => copy(cmd)}>Copier</button>
          </div>
        {/each}
        <p class="mt-3 text-xs text-zinc-500">
          Ponctuellement, sans enregistrer : <code class="font-mono">sshx --platform {origin} --platform-token &lt;jeton&gt;</code>.
          Une machine où sshx tourne en service reprend la configuration au redémarrage du service.
        </p>
      </div>
    {/if}

    <div class="mt-6 space-y-3">
      {#each list as m (m.id)}
        {@const owner = m.ownerId === $me?.user.id}
        <div class="panel p-4">
          {#if editing === m.id}
            <div class="grid gap-2 sm:grid-cols-[1fr_auto_1fr_auto_auto]">
              <input class="input" bind:value={edit.name} />
              <select class="input" bind:value={edit.kind}>
                <option value="personal">Personnelle</option>
                <option value="project">Projet</option>
              </select>
              <input class="input" bind:value={edit.project} disabled={edit.kind !== "project"} placeholder="projet" />
              <button class="btn-primary" on:click={() => saveEdit(m)}>Enregistrer</button>
              <button class="btn" on:click={() => (editing = null)}>Annuler</button>
            </div>
          {:else}
            <div class="flex flex-wrap items-center gap-2">
              <span class="h-2 w-2 rounded-full" class:bg-emerald-400={onlineSessions(m) > 0} class:bg-zinc-600={onlineSessions(m) === 0} />
              <span class="font-medium text-zinc-100">{m.name}</span>
              <span class="rounded border border-zinc-700 px-1.5 text-[11px] text-zinc-400">
                {m.kind === "project" ? `projet${m.project ? " · " + m.project : ""}` : "personnelle"}
              </span>
              {#if !owner}<span class="text-xs text-zinc-500">partagée par {m.ownerName}</span>{/if}
              <span class="flex-1" />
              <span class="text-xs text-zinc-500">
                {onlineSessions(m)} session{onlineSessions(m) > 1 ? "s" : ""} en ligne · vue {ago(m.lastSeenAt)}
              </span>
            </div>
            {#if owner}
              <div class="mt-1 font-mono text-[11px] text-zinc-600">jeton {m.tokenHint}…</div>
              <div class="mt-3 flex flex-wrap gap-2">
                <button class="btn text-xs" on:click={() => startEdit(m)}>Modifier</button>
                <button class="btn text-xs" on:click={() => rotate(m)}>Nouveau jeton</button>
                <button class="btn-danger text-xs" on:click={() => remove(m)}>Supprimer</button>
              </div>
              <div class="mt-3 border-t border-zinc-700/60 pt-3">
                <div class="text-xs text-zinc-500">Accès</div>
                <div class="mt-1 flex flex-wrap gap-1.5">
                  {#each m.members as member (member.userId)}
                    <span class="inline-flex items-center gap-1 rounded-full border border-zinc-700 px-2 py-0.5 text-xs text-zinc-300">
                      {member.displayName}
                      {#if member.userId !== m.ownerId}
                        <button class="text-zinc-500 hover:text-red-300" title="Retirer l'accès" on:click={() => unshare(m, member.userId)}>✕</button>
                      {/if}
                    </span>
                  {/each}
                </div>
                <div class="mt-2 flex gap-2">
                  <select class="input py-1 text-xs" bind:value={shareTarget[m.id]}>
                    <option value="">Partager avec…</option>
                    {#each users.filter((u) => !m.members.some((x) => x.userId === u.id)) as u (u.id)}
                      <option value={u.id} disabled={!u.publicKey}>
                        {u.displayName} ({u.username}){u.publicKey ? ` · clé ${fingerprints[u.id] ?? ""}` : " · chiffrement non configuré"}
                      </option>
                    {/each}
                  </select>
                  <button class="btn text-xs" disabled={!shareTarget[m.id]} on:click={() => share(m)}>Partager</button>
                </div>
                <p class="mt-1 text-[11px] text-zinc-600">
                  Le partage chiffre la clé de la machine pour la clé publique du destinataire. Vérifiez
                  l'empreinte avec lui si le serveur n'est pas de confiance.
                </p>
              </div>
            {/if}
          {/if}
        </div>
      {:else}
        <p class="text-sm text-zinc-500">Aucune machine. Créez un jeton ci-dessus, puis lancez sshx sur la machine.</p>
      {/each}
    </div>
  </div>
</VaultGate>
