<!-- @component A terminal with its header: identity, agent state, actions. -->
<script lang="ts">
  import { createEventDispatcher, onDestroy, tick } from "svelte";
  import { writable, type Readable } from "svelte/store";

  import { ideConnectionToken } from "$sshx/ideToken";

  import { api } from "$lib/api";
  import { me } from "$lib/auth";
  import { acquire, release, type ConnectionStatus, type SessionConnection } from "$lib/connection";
  import { lastSeen, needsAttention, requestNotificationPermission } from "$lib/notify";
  import { termFontSize, TERM_FONT_MAX, TERM_FONT_MIN } from "$lib/settings";
  import { shortcutLabels } from "$lib/shortcuts";
  import { ago, now } from "$lib/time";
  import { toast, toastError } from "$lib/toast";
  import { items, renameTerminal, sessionLink, sessionSecret, setBell, setPinned, type TermItem } from "$lib/workspace";
  import Icon from "./Icon.svelte";
  import Menu, { type MenuItem } from "./Menu.svelte";
  import MobileKeys from "./MobileKeys.svelte";
  import StatusBadge from "./StatusBadge.svelte";
  import XTermView from "./XTermView.svelte";

  export let itemKey: string;
  export let mobile = false;

  const dispatch = createEventDispatcher<{ back: void; closed: void; create: TermItem }>();

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
  export async function startRename() {
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
    focus();
  }

  /** `~` for the home directory, and only the last folders of long paths. */
  function shortPath(path?: string): string | undefined {
    if (!path) return undefined;
    const home = item?.session.username ? new RegExp(`^/(home|Users)/${item.session.username}(?=/|$)`) : null;
    const short = home ? path.replace(home, "~") : path;
    const parts = short.split("/");
    return short.length > 40 && parts.length > 4 ? `…/${parts.slice(-3).join("/")}` : short;
  }

  let confirmClose = false;
  let confirmButton: HTMLButtonElement;

  /** Ask before closing: Enter confirms, Escape cancels. */
  export async function askClose() {
    if (!item?.online) return;
    confirmClose = true;
    await tick();
    confirmButton?.focus();
  }

  function cancelClose() {
    confirmClose = false;
    focus();
  }

  function closeTerminal() {
    confirmClose = false;
    conn?.close(sid);
    dispatch("closed");
  }

  async function share() {
    if (!item) return;
    try {
      await navigator.clipboard.writeText(await sessionLink(item.session));
      toast("Lien sshx copié. Il donne accès à toute la session de cette machine.", "success", 6000);
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

  /**
   * VS Code in a new tab, on the terminal's current folder. The machine runs
   * one OpenVSCode Server per session (IDE 1), installed on first use; IDE
   * traffic goes to the sshx server directly, unencrypted end to end.
   */
  async function openIde() {
    if (!item) return;
    try {
      const { key } = await sessionSecret(item.session);
      const origin = new URL(item.session.url).origin;
      const query = new URLSearchParams({ tkn: await ideConnectionToken(key) });
      const folder = item.meta?.cwd ?? item.meta?.agent?.cwd;
      if (folder) query.set("folder", folder);
      window.open(`${origin}/ide/s/${item.session.name}/1/?${query}`, "_blank", "noopener");
    } catch (err) {
      toastError(err);
    }
  }

  async function forget() {
    if (!item) return;
    try {
      await api.forgetSession(item.session.name);
      dispatch("closed");
    } catch (err) {
      toastError(err);
    }
  }

  async function toggleBell() {
    if (!item) return;
    if (!item.bell) await requestNotificationPermission();
    setBell(item, !item.bell).catch(toastError);
  }

  function fontBy(delta: number) {
    termFontSize.update((s) => Math.min(TERM_FONT_MAX, Math.max(TERM_FONT_MIN, s + delta)));
  }

  let menu: { x: number; y: number; items: MenuItem[] } | null = null;
  function openMenu(e: MouseEvent) {
    if (!item) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const list: MenuItem[] = [
      { label: "Renommer", icon: "edit", hint: $shortcutLabels.rename, run: startRename },
      { label: item.bell ? "Couper les notifications" : "Me notifier", icon: "bell", run: toggleBell },
      { label: item.pinned ? "Désépingler" : "Épingler en haut", icon: "pin", run: () => item && setPinned(item, !item.pinned).catch(toastError) },
      "separator",
      { label: "Agrandir le texte", icon: "text", hint: `${$termFontSize} px`, disabled: $termFontSize >= TERM_FONT_MAX, run: () => fontBy(1) },
      { label: "Réduire le texte", icon: "text", disabled: $termFontSize <= TERM_FONT_MIN, run: () => fontBy(-1) },
    ];
    if (item.online) {
      list.push(
        "separator",
        { label: "Voir la machine en canevas sshx", icon: "canvas", run: openCanvas },
        {
          label: "Ouvrir dans VS Code",
          icon: "code",
          disabled: !$ideAvailable,
          title: $ideAvailable ? undefined : "Mettez sshx à jour sur la machine, ou lancez-le avec --ide",
          hint: $ideAvailable ? undefined : "sshx --ide",
          run: openIde,
        },
        { label: "Copier le lien sshx", icon: "share", run: share },
        "separator",
        { label: "Fermer le terminal", icon: "x", danger: true, hint: $shortcutLabels.close, run: askClose },
      );
    }
    menu = { x: rect.right, y: rect.bottom + 6, items: list };
  }

  const BANNER: Record<string, string> = {
    question: "pose une question",
    permission: "demande une autorisation",
    done: "a terminé",
  };

  let expanded = false;
  let hiddenDone = "";
  $: agent = item?.meta?.agent;
  $: agentLabel = agent?.kind === "claude" ? "Claude" : agent?.kind ?? "L'agent";
  $: urgent = item?.state === "question" || item?.state === "permission";
  $: unread = item ? needsAttention(item, $lastSeen) : false;
  $: doneStamp = item?.state === "done" ? `${item.key}:${item.since}` : "";
  $: showBanner = !!item?.online && !!agent && (urgent || (item?.state === "done" && !!agent.message && hiddenDone !== doneStamp));
  $: shellMissing = conn && $status === "connected" && $shells.size > 0 && !$shells.has(sid);
  $: fontSize = mobile ? Math.max(TERM_FONT_MIN, $termFontSize - 1) : $termFontSize;
  $: subtitle = item
    ? [item.machine.name, shortPath(item.meta?.cwd), item.meta?.git?.branch].filter(Boolean).join(" · ")
    : "";
</script>

<div class="flex h-full min-h-0 flex-col bg-[#181818]" data-testid="terminal-pane" data-key={itemKey}>
  <!-- Header -->
  <header class="flex h-14 shrink-0 items-center gap-2.5 border-b border-zinc-800 px-3">
    {#if mobile}
      <button class="icon-btn -ml-1 h-9 w-9" on:click={() => dispatch("back")} aria-label="Retour à la liste">
        <Icon name="chevronLeft" size={22} />
      </button>
    {/if}
    <StatusBadge state={item?.state ?? "none"} online={item?.online ?? false} {unread} size="md" />
    <div class="min-w-0 flex-1">
      {#if editing}
        <!-- svelte-ignore a11y-autofocus -->
        <input
          bind:this={nameInput}
          bind:value={draft}
          class="w-full max-w-md rounded-md border border-indigo-400 bg-zinc-950 px-1.5 py-px text-[15px] font-semibold text-zinc-100 outline-none"
          aria-label="Nom du terminal"
          on:blur={commitRename}
          on:keydown={(e) => {
            if (e.key === "Enter") commitRename();
            if (e.key === "Escape") {
              editing = false;
              focus();
            }
          }}
          autofocus
        />
      {:else}
        <button
          class="block max-w-full truncate text-left text-[15px] font-semibold leading-6 text-zinc-50"
          title="Double-cliquer pour renommer"
          data-testid="pane-title"
          on:dblclick={startRename}
        >
          {item?.name ?? "Ouverture…"}
        </button>
      {/if}
      {#if subtitle}<div class="truncate font-mono text-xs leading-5 text-zinc-500" title={item?.meta?.cwd}>{subtitle}</div>{/if}
    </div>
    {#if item?.online}
      {#if conn && $status !== "connected"}
        <span class="text-sm text-zinc-500">{$status === "connecting" ? "Connexion…" : $status === "error" ? "Erreur" : "Reconnexion…"}</span>
      {/if}
      {#if !$canWrite}<span class="rounded-md border border-zinc-700 px-1.5 py-0.5 text-xs text-zinc-400" title="Session en lecture seule">Lecture seule</span>{/if}
      {#if !mobile && $ideAvailable}
        <button
          class="icon-btn"
          title="Ouvrir dans VS Code{item.meta?.cwd ? ` (${shortPath(item.meta.cwd)})` : ''}"
          aria-label="Ouvrir dans VS Code"
          data-testid="open-ide"
          on:click={openIde}
        >
          <Icon name="code" size={18} />
        </button>
      {/if}
      {#if !mobile}
        <button class="icon-btn" title="Nouveau terminal sur {item.machine.name} ({$shortcutLabels.new})" aria-label="Nouveau terminal" on:click={() => item && dispatch("create", item)}>
          <Icon name="plus" size={18} />
        </button>
      {/if}
    {/if}
    {#if item}
      <button class="icon-btn" title="Actions" aria-label="Actions du terminal" data-testid="pane-menu" on:click={openMenu}>
        <Icon name="more" size={18} stroke={2.6} />
      </button>
    {/if}
  </header>

  {#if confirmClose && item}
    <div class="flex shrink-0 flex-wrap items-center gap-3 border-b border-red-900/60 bg-red-950/50 px-4 py-2.5 text-sm text-red-100">
      <span class="min-w-0 flex-1">Fermer « {item.name} » ? Le shell et les programmes qu'il exécute seront arrêtés.</span>
      <button class="btn" on:click={cancelClose}>Annuler</button>
      <button
        bind:this={confirmButton}
        class="btn-danger"
        data-testid="confirm-close"
        on:click={closeTerminal}
        on:keydown={(e) => e.key === "Escape" && cancelClose()}
      >
        Fermer le terminal
      </button>
    </div>
  {/if}

  <!-- Agent banner -->
  {#if showBanner && item && agent}
    <div
      class="flex shrink-0 items-start gap-3 border-b px-4 py-2.5"
      class:border-amber-900={item.state === "question"}
      class:bg-amber-950={item.state === "question"}
      class:border-orange-900={item.state === "permission"}
      class:bg-orange-950={item.state === "permission"}
      class:border-zinc-800={item.state === "done"}
      class:bg-zinc-900={item.state === "done"}
      data-testid="agent-banner"
      data-state={item.state}
    >
      <div class="pt-0.5"><StatusBadge state={item.state} unread={item.state === "done"} /></div>
      <button class="min-w-0 flex-1 text-left" on:click={() => (expanded = !expanded)} title={expanded ? "Réduire" : "Tout afficher"}>
        <div class="flex items-baseline gap-2 text-sm">
          <span
            class="font-semibold"
            class:text-amber-200={item.state === "question"}
            class:text-orange-200={item.state === "permission"}
            class:text-emerald-300={item.state === "done"}
          >
            {agentLabel} {BANNER[item.state]}
          </span>
          <span class="text-xs text-zinc-500">{ago(item.since, $now)}</span>
        </div>
        {#if agent.message || agent.tool}
          <p
            class="mt-0.5 whitespace-pre-wrap text-[14px] leading-relaxed"
            class:line-clamp-3={!expanded}
            class:text-zinc-100={urgent}
            class:text-zinc-300={!urgent}
            data-testid="agent-message"
          >
            {agent.message ?? agent.tool}
          </p>
        {/if}
      </button>
      {#if item.state === "done"}
        <button class="icon-btn -mr-1 h-7 w-7" title="Masquer" aria-label="Masquer" on:click={() => (hiddenDone = doneStamp)}>
          <Icon name="x" size={15} />
        </button>
      {:else}
        <button class="btn shrink-0 py-1" on:click={focus}>Répondre</button>
      {/if}
    </div>
  {/if}

  <!-- Body -->
  <div class="relative min-h-0 flex-1">
    {#if !item}
      <div class="flex h-full items-center justify-center text-[15px] text-zinc-500">Ouverture du terminal…</div>
    {:else if !item.online}
      <div class="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <p class="text-[15px] text-zinc-300"><span class="font-semibold">{item.machine.name}</span> est hors ligne.</p>
        <p class="max-w-sm text-sm text-zinc-500">
          Relancez <code class="font-mono text-zinc-400">sshx</code> sur la machine pour retrouver ses terminaux. Une session
          lancée avec <code class="font-mono text-zinc-400">--slug</code> garde les mêmes noms.
        </p>
        <button class="btn-danger mt-2" on:click={forget}>Oublier cette session</button>
      </div>
    {:else if connError || $errorStore}
      <div class="flex h-full items-center justify-center p-6 text-center text-[15px] text-red-400">{connError ?? $errorStore}</div>
    {:else if shellMissing}
      <div class="flex h-full items-center justify-center text-[15px] text-zinc-500">Ce terminal a été fermé.</div>
    {:else if conn}
      {#key `${conn.name}/${sid}`}
        <XTermView bind:this={view} {conn} {sid} {fontSize} bind:ctrlArmed />
      {/key}
    {:else}
      <div class="flex h-full items-center justify-center text-[15px] text-zinc-500">Déchiffrement…</div>
    {/if}
  </div>

  {#if mobile && conn && item?.online}
    <MobileKeys bind:ctrlArmed on:key={(e) => view?.send(e.detail)} />
  {/if}
</div>

{#if menu}
  <Menu x={menu.x} y={menu.y} items={menu.items} alignRight on:close={() => (menu = null)} />
{/if}
