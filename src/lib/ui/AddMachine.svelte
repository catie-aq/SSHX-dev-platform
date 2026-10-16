<!--
  @component Connect a machine in two steps: name it, then run one command on
  it. Waits live for the machine's first session.
-->
<script lang="ts">
  import { createEventDispatcher, onDestroy, onMount, tick } from "svelte";

  import { api, type Machine, type Session } from "$lib/api";
  import { config } from "$lib/auth";
  import { toastError } from "$lib/toast";
  import { composeToken, machineKeyRaw, newMachineKey } from "$lib/vault";
  import { items, loadWorkspace, machines, sessions } from "$lib/workspace";
  import CopyCommand from "./CopyCommand.svelte";
  import Icon from "./Icon.svelte";

  /** Open the machine's first terminal by itself once connected. */
  export let autoOpen = false;
  /** Show a new command for an existing machine (revokes its old token). */
  export let existing: Machine | null = null;

  const dispatch = createEventDispatcher<{ open: string; create: Session; created: string; close: void }>();

  let name = "";
  let kind: "personal" | "project" = "personal";
  let project = "";
  let busy = false;
  let created: { id: string; name: string; token: string } | null = null;
  let nameInput: HTMLInputElement;
  let opened = false;

  $: base = $config?.publicUrl ?? (typeof window !== "undefined" ? window.location.origin : "");
  $: command = created ? `sshx platform enroll ${base} ${created.token} && sshx` : "";
  $: serviceCommand = created ? `sshx platform enroll ${base} ${created.token}` : "";
  $: connectedSession = created ? [...$sessions.values()].find((s) => s.machineId === created?.id && s.online) : undefined;
  $: connected = !!connectedSession;
  $: firstTerminal = created ? $items.find((i) => i.machine.id === created?.id && i.online) : undefined;
  $: if (autoOpen && connectedSession && !opened) autoOpenSoon(connectedSession);

  /** Open the first terminal, or a new one: a new sshx session has none. */
  function autoOpenSoon(session: Session) {
    opened = true;
    // Give the first state report a moment to list existing terminals.
    setTimeout(() => openTerminal(session), 1200);
  }

  function openTerminal(session: Session | undefined) {
    if (firstTerminal) dispatch("open", firstTerminal.key);
    else if (session) dispatch("create", session);
  }

  export async function focus() {
    await tick();
    nameInput?.focus();
  }

  async function create() {
    if (!name.trim()) return;
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
      created = { id, name: name.trim(), token: composeToken(res.token, raw) };
      dispatch("created", id);
      await loadWorkspace();
    } catch (err) {
      toastError(err);
    } finally {
      busy = false;
    }
  }

  onMount(async () => {
    if (!existing) return;
    busy = true;
    try {
      const res = await api.rotateToken(existing.id);
      created = { id: existing.id, name: existing.name, token: composeToken(res.token, await machineKeyRaw(existing)) };
    } catch (err) {
      toastError(err);
    } finally {
      busy = false;
    }
  });

  // The session list is live (SSE); poll as a fallback while waiting.
  const poll = setInterval(() => {
    if (created && !connected) loadWorkspace().catch(() => {});
  }, 5000);
  onDestroy(() => clearInterval(poll));

  $: takenNames = new Set([...$machines.values()].map((m) => m.name.toLowerCase()));
  $: duplicate = !created && takenNames.has(name.trim().toLowerCase());
</script>

<div class="space-y-5" data-testid="add-machine">
  {#if existing && !created}
    <p class="text-sm text-zinc-400">{busy ? "Création d'un nouveau jeton…" : "Impossible de créer un jeton."}</p>
  {:else if !created}
    <form class="space-y-4" on:submit|preventDefault={create}>
      <div>
        <label class="label" for="machine-name">Nom de la machine</label>
        <!-- svelte-ignore a11y-autofocus -->
        <input
          id="machine-name"
          bind:this={nameInput}
          class="input"
          bind:value={name}
          placeholder="ex. portable, gpu-traduction"
          autocomplete="off"
          autofocus
          required
        />
        {#if duplicate}<p class="mt-1 text-xs text-amber-300">Une machine porte déjà ce nom.</p>{/if}
      </div>
      <fieldset>
        <legend class="label">Usage</legend>
        <div class="grid grid-cols-2 gap-2">
          {#each [["personal", "Personnelle", "Votre PC ou votre serveur"], ["project", "Projet", "Partageable avec l'équipe"]] as [value, title, hint]}
            <label
              class="cursor-pointer rounded-lg border px-3 py-2.5 transition-colors"
              class:border-indigo-400={kind === value}
              class:bg-indigo-500-10={kind === value}
              class:border-zinc-700={kind !== value}
              class:hover:border-zinc-500={kind !== value}
            >
              <input type="radio" class="sr-only" bind:group={kind} {value} />
              <span class="block text-sm font-medium text-zinc-100">{title}</span>
              <span class="block text-xs text-zinc-400">{hint}</span>
            </label>
          {/each}
        </div>
      </fieldset>
      {#if kind === "project"}
        <div>
          <label class="label" for="machine-project">Projet</label>
          <input id="machine-project" class="input" bind:value={project} placeholder="ex. traduction" />
        </div>
      {/if}
      <div class="flex items-center gap-3">
        <button class="btn-primary" disabled={busy || !name.trim()}>
          {busy ? "Création…" : "Générer la commande"}
        </button>
        <slot name="cancel" />
      </div>
    </form>
  {:else}
    <div class="space-y-3">
      {#if existing}
        <p class="text-sm text-zinc-400">L'ancien jeton de cette machine est révoqué : reconnectez-la avec cette commande.</p>
      {/if}
      <p class="text-[15px] text-zinc-200">
        Sur <span class="font-semibold text-zinc-50">{created.name}</span>, collez cette commande dans un terminal :
      </p>
      <CopyCommand command={command} testid="enroll-command" large />
      <p class="text-sm text-zinc-400">
        Elle relie la machine à votre compte, active le suivi de Claude Code, puis ouvre une session sshx.
      </p>
    </div>

    <div
      class="flex items-center gap-3 rounded-lg border px-4 py-3"
      class:border-emerald-700={connected}
      class:bg-emerald-950={connected}
      class:border-zinc-700={!connected}
      class:bg-zinc-900={!connected}
      data-testid="enroll-status"
      data-connected={connected}
    >
      {#if connected}
        <span class="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-400 text-zinc-950"><Icon name="check" size={14} stroke={3} /></span>
        <div class="min-w-0 flex-1">
          <p class="text-[15px] font-medium text-emerald-200">{created.name} est connectée</p>
          {#if autoOpen}<p class="text-sm text-emerald-300/80">Ouverture du terminal…</p>{/if}
        </div>
        {#if !autoOpen}
          <button class="btn-primary" on:click={() => openTerminal(connectedSession)}>Ouvrir un terminal</button>
        {/if}
      {:else}
        <span class="relative flex h-3 w-3 shrink-0">
          <span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-indigo-400 opacity-50" />
          <span class="relative inline-flex h-3 w-3 rounded-full bg-indigo-400" />
        </span>
        <p class="text-[15px] text-zinc-300">En attente de la machine…</p>
      {/if}
    </div>

    <div class="space-y-2 text-sm">
      <details class="group rounded-lg border border-zinc-800 px-3 py-2">
        <summary class="cursor-pointer select-none text-zinc-300 marker:text-zinc-500">sshx tourne déjà en service sur cette machine</summary>
        <div class="mt-2 space-y-2 text-zinc-400">
          <p>Sous l'utilisateur du service, enregistrez la machine sans ouvrir de session :</p>
          <CopyCommand command={serviceCommand} />
          <p>puis redémarrez le service. Ajoutez <code class="font-mono text-zinc-300">--slug &lt;nom&gt;</code> au service pour garder les mêmes terminaux nommés d'un redémarrage à l'autre.</p>
        </div>
      </details>
      <details class="rounded-lg border border-zinc-800 px-3 py-2">
        <summary class="cursor-pointer select-none text-zinc-300 marker:text-zinc-500">« platform » est une commande inconnue</summary>
        <p class="mt-2 text-zinc-400">
          La machine a une version de sshx sans la plateforme. Installez la version CATIE depuis
          <a class="text-indigo-300 underline" href={$config?.sshxServer} target="_blank" rel="noreferrer">{$config?.sshxServer}</a>,
          ou compilez la branche <code class="font-mono text-zinc-300">platform</code> du dépôt sshx.
        </p>
      </details>
      <details class="rounded-lg border border-zinc-800 px-3 py-2">
        <summary class="cursor-pointer select-none text-zinc-300 marker:text-zinc-500">Vérifier l'installation</summary>
        <div class="mt-2 space-y-2 text-zinc-400">
          <p>Sur la machine, cette commande teste chaque maillon (plateforme, jeton, serveur sshx, hooks Claude) :</p>
          <CopyCommand command="sshx platform status" />
        </div>
      </details>
    </div>
    <p class="flex items-start gap-2 text-xs text-zinc-500">
      <Icon name="shield" size={14} class="mt-px" />
      Cette commande n'est affichée qu'une fois. Ce qui suit le point est la clé de la machine : elle chiffre ses
      terminaux et ne passe jamais par le serveur.
    </p>
  {/if}
</div>

<style>
  .bg-indigo-500-10 {
    background-color: rgb(99 102 241 / 0.1);
  }
</style>
