<!-- @component A terminal with its header: identity, agent state, actions. -->
<script lang="ts">
  import { createEventDispatcher, onDestroy, tick } from "svelte";
  import { writable, type Readable } from "svelte/store";

  import { ideConnectionToken } from "$sshx/ideToken";

  import { api } from "$lib/api";
  import { me } from "$lib/auth";
  import { acquire, release, type ConnectionStatus, type SessionConnection } from "$lib/connection";
  import { lastSeen, needsAttention } from "$lib/notify";
  import { toast, toastError } from "$lib/toast";
  import { items, renameTerminal, sessionLink, sessionSecret, type TermItem } from "$lib/workspace";
  import MobileKeys from "./MobileKeys.svelte";
  import StatusBadge from "./StatusBadge.svelte";
  import XTermView from "./XTermView.svelte";

  export let itemKey: string;
  export let mobile = false;
  export let canSplit = false;
  export let closable = false;
  export let active = true;

  const dispatch = createEventDispatcher<{ back: void; closePane: void; split: void; create: TermItem }>();

  $: item = $items.find((i) => i.key === itemKey) as TermItem | undefined;
  $: sid = Number(itemKey.split("/")[1]);

  let conn: SessionConnection | null = null;
  let connFor = "";
  let connError: string | null = null;
  let status: Readable<ConnectionStatus> = writable("connecting");
  let shells: Readable<Map<number, unknown>> = writable(new Map());
  let ideAvailable: Readable<boolean> = writable(false);
  let errorStore: Readable<string | null> = writable(null);
  let canWrite: Readable<boolean> = writable(true);

  $: if (item?.online && connFor !== item.session.name) connect(item);

  async function connect(target: TermItem) {
    const name = target.session.name;
    const prev = conn;
    connFor = name;
    conn = null;
    connError = null;
    if (prev) release(prev);
    try {
      const c = await acquire(target.session, $me?.user.displayName ?? "platform");
      if (connFor !== name) return release(c);
      conn = c;
      status = c.status;
      shells = c.shells;
      ideAvailable = c.ideAvailable;
      errorStore = c.error;
      canWrite = c.canWrite;
    } catch (err) {
      connError = err instanceof Error ? err.message : String(err);
    }
  }

  onDestroy(() => {
    if (conn) release(conn);
  });

  let view: XTermView;
  let ctrlArmed = false;
  export function focus() {
    view?.focus();
  }

  // Inline rename.
  let editing = false;
  let draft = "";
  let nameInput: HTMLInputElement;
  async function startRename() {
    if (!item) return;
    draft = item.customName ?? item.name;
    editing = true;
    await tick();
    nameInput?.select();
  }
  function commitRename() {
    if (!editing || !item) return;
    editing = false;
    if (draft.trim() !== (item.customName ?? item.name)) renameTerminal(item, draft).catch(toastError);
  }

  function shortPath(path?: string): string | undefined {
    if (!path) return undefined;
    const home = item?.session.username ? new RegExp(`^/(home|Users)/${item.session.username}(?=/|$)`) : null;
    return home ? path.replace(home, "~") : path;
  }

  let confirmClose = false;
  let confirmTimer: ReturnType<typeof setTimeout>;
  function closeTerminal() {
    if (!confirmClose) {
      confirmClose = true;
      clearTimeout(confirmTimer);
      confirmTimer = setTimeout(() => (confirmClose = false), 3000);
      return;
    }
    confirmClose = false;
    conn?.close(sid);
    dispatch("closePane");
  }

  async function share() {
    if (!item) return;
    try {
      await navigator.clipboard.writeText(await sessionLink(item.session));
      toast("Lien sshx copié : il donne accès à toute la session de cette machine.", "success", 6000);
    } catch (err) {
      toastError(err);
    }
  }

  async function openCanvas() {
    if (!item) return;
    try {
      window.open(await sessionLink(item.session), "_blank", "noopener");
    } catch (err) {
      toastError(err);
    }
  }

  async function openIde() {
    if (!item) return;
    try {
      const { key } = await sessionSecret(item.session);
      const origin = new URL(item.session.url).origin;
      const token = await ideConnectionToken(key);
      window.open(`${origin}/ide/s/${item.session.name}/1/?tkn=${token}`, "_blank", "noopener");
    } catch (err) {
      toastError(err);
    }
  }

  async function forget() {
    if (!item) return;
    try {
      await api.forgetSession(item.session.name);
      dispatch("closePane");
    } catch (err) {
      toastError(err);
    }
  }

  $: agent = item?.meta?.agent;
  $: urgent = item?.state === "question" || item?.state === "permission";
  $: unread = item ? needsAttention(item, $lastSeen) : false;
  $: shellMissing = conn && $status === "connected" && $shells.size > 0 && !$shells.has(sid);
  $: fontSize = mobile ? 12 : 14;
</script>

<div class="flex h-full min-h-0 flex-col bg-zinc-900" class:opacity-95={!active && !mobile}>
  <!-- Header -->
  <div class="flex shrink-0 items-center gap-2 border-b border-zinc-800 px-2 py-1.5">
    {#if mobile}
      <button class="px-1.5 text-lg leading-none text-zinc-400" on:click={() => dispatch("back")} aria-label="Retour">‹</button>
    {/if}
    <StatusBadge state={item?.state ?? "none"} online={item?.online ?? false} {unread} size="md" />
    <div class="min-w-0 flex-1">
      {#if editing}
        <!-- svelte-ignore a11y-autofocus -->
        <input
          bind:this={nameInput}
          bind:value={draft}
          class="w-full rounded border border-indigo-500 bg-zinc-900 px-1 text-sm text-zinc-100 outline-none"
          on:blur={commitRename}
          on:keydown={(e) => {
            if (e.key === "Enter") commitRename();
            if (e.key === "Escape") editing = false;
          }}
          autofocus
        />
      {:else}
        <button class="block max-w-full truncate text-left text-sm font-medium text-zinc-100" title="Double-cliquer pour renommer" on:dblclick={startRename}>
          {item?.name ?? "Ouverture…"}
        </button>
      {/if}
      {#if item}
        <div class="truncate font-mono text-[11px] text-zinc-500">
          {item.machine.name}{#if item.meta?.cwd} · {shortPath(item.meta.cwd)}{/if}{#if item.meta?.git?.branch} · {item.meta.git.branch}{/if}
        </div>
      {/if}
    </div>
    {#if item?.online}
      <div class="flex shrink-0 items-center gap-1 text-xs">
        {#if conn && $status !== "connected"}
          <span class="text-zinc-500">{$status === "connecting" ? "connexion…" : $status === "error" ? "erreur" : "déconnecté"}</span>
        {/if}
        {#if !$canWrite}<span class="rounded border border-zinc-700 px-1 text-zinc-400" title="Session en lecture seule">lecture</span>{/if}
        {#if !mobile}
          <button class="btn px-1.5 py-0.5 text-xs" title="Nouveau terminal sur cette machine" on:click={() => item && dispatch("create", item)}>＋</button>
          {#if canSplit}<button class="btn px-1.5 py-0.5 text-xs" title="Diviser (Alt+clic dans la liste)" on:click={() => dispatch("split")}>⇆</button>{/if}
          <button class="btn px-1.5 py-0.5 text-xs" title="Voir toute la machine en canevas sshx" on:click={openCanvas}>Canevas</button>
          <button class="btn px-1.5 py-0.5 text-xs" title={$ideAvailable ? "Ouvrir VS Code sur cette machine" : "Lancez sshx avec --ide pour activer VS Code"} disabled={!$ideAvailable} on:click={openIde}>VS Code</button>
          <button class="btn px-1.5 py-0.5 text-xs" title="Copier le lien sshx de la session" on:click={share}>Partager</button>
        {/if}
        <button class="btn px-1.5 py-0.5 text-xs" class:btn-danger={confirmClose} title="Fermer le terminal (tue le shell)" on:click={closeTerminal}>
          {confirmClose ? "Confirmer" : "Fermer"}
        </button>
      </div>
    {/if}
    {#if closable && !mobile}
      <button class="px-1 text-zinc-500 hover:text-zinc-200" title="Retirer ce panneau" on:click={() => dispatch("closePane")}>✕</button>
    {/if}
  </div>

  <!-- Agent banner -->
  {#if item?.online && agent && (urgent || (item.state === "done" && agent.message))}
    <button
      class="flex shrink-0 items-start gap-2 border-b px-3 py-1.5 text-left text-xs"
      class:border-amber-900={urgent}
      class:bg-amber-950={urgent}
      class:text-amber-200={urgent}
      class:border-zinc-800={!urgent}
      class:text-zinc-400={!urgent}
      on:click={focus}
    >
      <span class="shrink-0 font-semibold">
        {item.state === "question" ? "Question" : item.state === "permission" ? "Autorisation" : "Terminé"}
      </span>
      <span class="line-clamp-3 whitespace-pre-wrap">{agent.message ?? agent.tool ?? ""}</span>
    </button>
  {/if}

  <!-- Body -->
  <div class="relative min-h-0 flex-1">
    {#if !item}
      <div class="flex h-full items-center justify-center text-sm text-zinc-500">Ouverture du terminal…</div>
    {:else if !item.online}
      <div class="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-sm text-zinc-500">
        <p>La session de <span class="text-zinc-300">{item.machine.name}</span> est hors ligne.</p>
        <p class="text-xs">Relancez sshx sur la machine pour retrouver ses terminaux.</p>
        <button class="btn-danger" on:click={forget}>Oublier cette session</button>
      </div>
    {:else if connError || $errorStore}
      <div class="flex h-full items-center justify-center p-6 text-center text-sm text-red-400">{connError ?? $errorStore}</div>
    {:else if shellMissing}
      <div class="flex h-full items-center justify-center text-sm text-zinc-500">Ce terminal a été fermé.</div>
    {:else if conn}
      {#key `${conn.name}/${sid}`}
        <XTermView bind:this={view} {conn} {sid} {fontSize} bind:ctrlArmed />
      {/key}
    {:else}
      <div class="flex h-full items-center justify-center text-sm text-zinc-500">Déchiffrement…</div>
    {/if}
  </div>

  {#if mobile && conn && item?.online}
    <MobileKeys bind:ctrlArmed on:key={(e) => view?.send(e.detail)} />
  {/if}
</div>
