<script lang="ts">
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";

  import { api, type Machine, type UserInfo } from "$lib/api";
  import { me } from "$lib/auth";
  import { fingerprint } from "$lib/crypto";
  import { ago, now } from "$lib/time";
  import { toast, toastError } from "$lib/toast";
  import AddMachine from "$lib/ui/AddMachine.svelte";
  import Icon from "$lib/ui/Icon.svelte";
  import Menu, { type MenuItem } from "$lib/ui/Menu.svelte";
  import Modal from "$lib/ui/Modal.svelte";
  import VaultGate from "$lib/ui/VaultGate.svelte";
  import { shareMachineKey, vaultStatus } from "$lib/vault";
  import { loadWorkspace, machines, sessions, startLive } from "$lib/workspace";

  let users: UserInfo[] = [];
  let shareTarget: Record<string, string> = {};
  let fingerprints: Record<string, string> = {};
  let sharingOpen: Record<string, boolean> = {};
  let editing: string | null = null;
  let edit = { name: "", kind: "personal" as "personal" | "project", project: "" };
  let adding = false;
  let reconnecting: Machine | null = null;
  let confirmDelete: Machine | null = null;
  let menu: { x: number; y: number; items: MenuItem[] } | null = null;

  $: list = [...$machines.values()].sort((a, b) => a.name.localeCompare(b.name));

  async function refresh() {
    await loadWorkspace();
    users = await api.users();
    for (const u of users) {
      if (u.publicKey && !fingerprints[u.id]) fingerprints[u.id] = await fingerprint(JSON.parse(u.publicKey));
    }
  }

  onMount(() =>
    vaultStatus.subscribe((s) => {
      if (s === "unlocked") {
        startLive();
        refresh().catch(toastError);
      }
    }),
  );

  async function remove(m: Machine) {
    confirmDelete = null;
    try {
      await api.deleteMachine(m.id);
      await refresh();
      toast(`${m.name} supprimée.`, "success");
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

  function onlineCount(m: Machine) {
    return [...$sessions.values()].filter((s) => s.machineId === m.id && s.online).length;
  }

  function machineMenu(m: Machine, e: MouseEvent) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    menu = {
      x: rect.right,
      y: rect.bottom + 6,
      items: [
        { label: "Modifier", icon: "edit", run: () => startEdit(m) },
        { label: "Nouvelle commande de connexion", icon: "key", hint: "révoque l'ancienne", run: () => (reconnecting = m) },
        "separator",
        { label: "Supprimer", icon: "trash", danger: true, run: () => (confirmDelete = m) },
      ],
    };
  }
</script>

<VaultGate>
  <div class="mx-auto max-w-3xl px-4 py-6 sm:py-10">
    <a href="/" class="btn-ghost -ml-2.5"><Icon name="chevronLeft" size={16} /> Terminaux</a>
    <div class="mt-3 flex flex-wrap items-center gap-3">
      <h1 class="flex-1 text-2xl font-semibold text-zinc-50">Machines</h1>
      <button class="btn-primary" on:click={() => (adding = true)} data-testid="add-machine-button">
        <Icon name="plus" size={16} stroke={2.4} /> Ajouter une machine
      </button>
    </div>
    <p class="mt-2 text-[15px] text-zinc-400">
      Chaque machine lance <code class="font-mono text-zinc-300">sshx</code> et apparaît avec ses terminaux. Les machines de
      projet peuvent être partagées avec l'équipe.
    </p>

    <div class="mt-6 space-y-3">
      {#each list as m (m.id)}
        {@const owner = m.ownerId === $me?.user.id}
        {@const online = onlineCount(m)}
        <div class="panel p-5" data-testid="machine-card" data-name={m.name}>
          {#if editing === m.id}
            <form class="grid gap-3 sm:grid-cols-[1fr_auto]" on:submit|preventDefault={() => saveEdit(m)}>
              <input class="input" bind:value={edit.name} aria-label="Nom" />
              <select class="input" bind:value={edit.kind} aria-label="Usage">
                <option value="personal">Personnelle</option>
                <option value="project">Projet</option>
              </select>
              {#if edit.kind === "project"}
                <input class="input sm:col-span-2" bind:value={edit.project} placeholder="Nom du projet" aria-label="Projet" />
              {/if}
              <div class="flex gap-2 sm:col-span-2">
                <button class="btn-primary">Enregistrer</button>
                <button type="button" class="btn-ghost" on:click={() => (editing = null)}>Annuler</button>
              </div>
            </form>
          {:else}
            <div class="flex items-start gap-3">
              <div class="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-zinc-800 text-zinc-400">
                <Icon name="monitor" size={18} />
              </div>
              <div class="min-w-0 flex-1">
                <div class="flex flex-wrap items-center gap-2">
                  <span class="text-[16px] font-semibold text-zinc-50">{m.name}</span>
                  <span class="rounded-md bg-zinc-800 px-2 py-0.5 text-xs text-zinc-300">
                    {m.kind === "project" ? `Projet${m.project ? " · " + m.project : ""}` : "Personnelle"}
                  </span>
                  {#if !owner}<span class="text-xs text-zinc-500">partagée par {m.ownerName}</span>{/if}
                </div>
                <div class="mt-1 flex items-center gap-2 text-sm">
                  <span class="h-2 w-2 rounded-full" class:bg-emerald-400={online > 0} class:bg-zinc-600={online === 0} />
                  {#if online > 0}
                    <span class="text-emerald-300">En ligne</span><span class="text-zinc-500">· {online} session{online > 1 ? "s" : ""}</span>
                  {:else if m.lastSeenAt}
                    <span class="text-zinc-400">Hors ligne · vue il y a {ago(m.lastSeenAt, $now)}</span>
                  {:else}
                    <span class="text-zinc-400">Jamais connectée</span>
                    {#if owner}<button class="text-indigo-300 underline-offset-2 hover:underline" on:click={() => (reconnecting = m)}>afficher la commande</button>{/if}
                  {/if}
                </div>
              </div>
              {#if owner}
                <button class="icon-btn" aria-label="Actions" on:click={(e) => machineMenu(m, e)}><Icon name="more" size={18} stroke={2.6} /></button>
              {/if}
            </div>

            {#if owner}
              <div class="mt-4 border-t border-zinc-800 pt-3">
                <button class="flex items-center gap-2 text-sm text-zinc-300 hover:text-zinc-100" on:click={() => (sharingOpen[m.id] = !sharingOpen[m.id])} aria-expanded={!!sharingOpen[m.id]}>
                  <Icon name={sharingOpen[m.id] ? "chevronDown" : "chevronRight"} size={15} class="text-zinc-500" />
                  <Icon name="users" size={15} class="text-zinc-500" />
                  Accès
                  <span class="text-zinc-500">{m.members.length > 1 ? `${m.members.length} personnes` : "vous seul"}</span>
                </button>
                {#if sharingOpen[m.id]}
                  <div class="mt-3 space-y-3 pl-6">
                    <div class="flex flex-wrap gap-1.5">
                      {#each m.members as member (member.userId)}
                        <span class="inline-flex items-center gap-1.5 rounded-full border border-zinc-700 px-2.5 py-1 text-sm text-zinc-200">
                          {member.displayName}{member.userId === m.ownerId ? " (vous)" : ""}
                          {#if member.userId !== m.ownerId}
                            <button class="text-zinc-500 hover:text-red-300" title="Retirer l'accès" aria-label="Retirer l'accès de {member.displayName}" on:click={() => unshare(m, member.userId)}>
                              <Icon name="x" size={13} />
                            </button>
                          {/if}
                        </span>
                      {/each}
                    </div>
                    <div class="flex gap-2">
                      <select class="input py-1.5 text-sm" bind:value={shareTarget[m.id]} aria-label="Partager avec" data-testid="share-select">
                        <option value="">Partager avec…</option>
                        {#each users.filter((u) => !m.members.some((x) => x.userId === u.id)) as u (u.id)}
                          <option value={u.id} disabled={!u.publicKey}>
                            {u.displayName} ({u.username}){u.publicKey ? ` · clé ${fingerprints[u.id] ?? ""}` : " · pas encore de phrase secrète"}
                          </option>
                        {/each}
                      </select>
                      <button class="btn" disabled={!shareTarget[m.id]} on:click={() => share(m)}>Partager</button>
                    </div>
                    <p class="text-xs leading-relaxed text-zinc-500">
                      La clé de la machine est chiffrée pour la personne choisie. Pour une sécurité maximale, vérifiez avec
                      elle l'empreinte affichée.
                    </p>
                  </div>
                {/if}
              </div>
            {/if}
          {/if}
        </div>
      {:else}
        <div class="panel p-8 text-center">
          <p class="text-[15px] text-zinc-300">Aucune machine pour l'instant.</p>
          <button class="btn-primary mt-4" on:click={() => (adding = true)}><Icon name="plus" size={16} /> Ajouter une machine</button>
        </div>
      {/each}
    </div>
  </div>
</VaultGate>

{#if menu}
  <Menu x={menu.x} y={menu.y} items={menu.items} alignRight on:close={() => (menu = null)} />
{/if}

{#if adding}
  <Modal title="Ajouter une machine" on:close={() => (adding = false)}>
    <AddMachine on:open={(e) => goto(`/?terminal=${encodeURIComponent(e.detail)}`)} on:create={(e) => goto(`/?newIn=${encodeURIComponent(e.detail.name)}`)}>
      <button slot="cancel" type="button" class="btn-ghost" on:click={() => (adding = false)}>Annuler</button>
    </AddMachine>
  </Modal>
{/if}

{#if reconnecting}
  <Modal title="Connecter {reconnecting.name}" on:close={() => (reconnecting = null)}>
    <AddMachine existing={reconnecting} on:open={(e) => goto(`/?terminal=${encodeURIComponent(e.detail)}`)} on:create={(e) => goto(`/?newIn=${encodeURIComponent(e.detail.name)}`)} />
  </Modal>
{/if}

{#if confirmDelete}
  <Modal title="Supprimer {confirmDelete.name} ?" width={440} on:close={() => (confirmDelete = null)}>
    <p class="text-[15px] leading-relaxed text-zinc-300">
      Son jeton est révoqué et ses sessions disparaissent de la plateforme. Les terminaux en cours sur la machine ne
      sont pas arrêtés.
    </p>
    <div class="mt-6 flex justify-end gap-2">
      <button class="btn-ghost" on:click={() => (confirmDelete = null)}>Annuler</button>
      <button class="btn-danger" on:click={() => confirmDelete && remove(confirmDelete)}>Supprimer</button>
    </div>
  </Modal>
{/if}
