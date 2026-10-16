<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { goto } from "$app/navigation";

  import { api, type Machine, type Session } from "$lib/api";
  import { me } from "$lib/auth";
  import { acquire, closeAll, release } from "$lib/connection";
  import { attention, markSeen, selectRequest, visibleKeys } from "$lib/notify";
  import { sidebarWidth } from "$lib/settings";
  import { learnKey, matchShortcut, recording, refreshLayout, type Shortcut } from "$lib/shortcuts";
  import { ago, now } from "$lib/time";
  import { toast, toastError } from "$lib/toast";
  import AddMachine from "$lib/ui/AddMachine.svelte";
  import Icon from "$lib/ui/Icon.svelte";
  import Logo from "$lib/ui/Logo.svelte";
  import Modal from "$lib/ui/Modal.svelte";
  import Palette from "$lib/ui/Palette.svelte";
  import ShortcutsHelp from "$lib/ui/ShortcutsHelp.svelte";
  import Sidebar from "$lib/ui/Sidebar.svelte";
  import StatusBadge from "$lib/ui/StatusBadge.svelte";
  import Steps from "$lib/ui/Steps.svelte";
  import TerminalPane from "$lib/ui/TerminalPane.svelte";
  import VaultGate from "$lib/ui/VaultGate.svelte";
  import { lockVault, vaultStatus } from "$lib/vault";
  import { items, itemsReady, loaded, machines, sessions, startLive, stopLive, termKey, type TermItem } from "$lib/workspace";

  const CURRENT_KEY = "sshx-platform:current";
  const HISTORY_LIMIT = 30;

  /** Key of the open terminal. */
  let current: string | null = null;
  /** Recently opened terminals, most recent first. */
  let history: string[] = [];
  let order: string[] = [];
  let mobile = false;
  let pane: TerminalPane | null = null;
  let addingMachine = false;
  let paletteOpen = false;
  let helpOpen = false;
  /** Machine whose connection command is shown again. */
  let reconnecting: Machine | null = null;
  /** First run: no machine yet. Kept until the wizard is done. */
  let onboarding: boolean | null = null;

  try {
    current = JSON.parse(localStorage.getItem(CURRENT_KEY) ?? "null");
    history = current ? [current] : [];
  } catch {
    current = null;
  }
  $: try {
    localStorage.setItem(CURRENT_KEY, JSON.stringify(current));
  } catch {
    /* ignore */
  }
  // Forget a terminal that no longer exists, once loaded.
  $: if ($itemsReady && current && !pendingKeys.has(current) && !$items.some((i) => i.key === current)) {
    current = null;
  }
  $: visibleKeys.set(new Set(current ? [current] : []));
  $: if (current) markSeen(current);

  const pendingKeys = new Set<string>();

  function select(key: string) {
    current = key;
    history = [key, ...history.filter((k) => k !== key)].slice(0, HISTORY_LIMIT);
    paletteOpen = false;
    markSeen(key);
    setTimeout(() => {
      // Do not steal focus from a field, e.g. the rename box of a double-click.
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
        if (!el.classList.contains("xterm-helper-textarea")) return;
      }
      pane?.focus();
    }, 50);
  }

  /** After closing the open terminal: go to the previous one still listed. */
  function afterClose(closed: string) {
    history = history.filter((k) => k !== closed);
    const next = history.find((k) => $items.some((i) => i.key === k && i.online)) ?? order.find((k) => k !== closed);
    if (next) select(next);
    else current = null;
  }

  function shellQuote(path: string) {
    return `'${path.replace(/'/g, `'\\''`)}'`;
  }

  async function createTerminal(session: Session, cwd?: string) {
    try {
      const conn = await acquire(session, $me?.user.displayName ?? "platform");
      try {
        const sid = await conn.create();
        if (cwd) {
          // Wait for the prompt so the command is not echoed twice.
          conn.firstOutput(sid).then(() => conn.input(sid, new TextEncoder().encode(`cd ${shellQuote(cwd)}\r`)));
        }
        const key = termKey(session.name, sid);
        pendingKeys.add(key);
        setTimeout(() => pendingKeys.delete(key), 15_000);
        select(key);
      } finally {
        release(conn);
      }
    } catch (err) {
      toastError(err);
    }
  }

  async function onAction(kind: string, item: TermItem) {
    try {
      if (kind === "close") {
        const conn = await acquire(item.session, $me?.user.displayName ?? "platform");
        conn.close(item.sid);
        release(conn);
        if (current === item.key) afterClose(item.key);
      } else if (kind === "forget") {
        await api.forgetSession(item.session.name);
      } else if (kind === "share" || kind === "canvas") {
        const { sessionLink } = await import("$lib/workspace");
        const link = await sessionLink(item.session);
        if (kind === "share") {
          await navigator.clipboard.writeText(link);
        } else {
          window.open(link, "_blank", "noopener");
        }
      }
    } catch (err) {
      toastError(err);
    }
  }

  async function logout() {
    closeAll();
    stopLive();
    await api.logout().catch(() => {});
    me.set(null);
    await goto("/login");
  }

  async function lock() {
    closeAll();
    stopLive();
    await lockVault();
  }

  function step(delta: number) {
    if (order.length === 0) return;
    const idx = current ? order.indexOf(current) : -1;
    const next = idx < 0 ? (delta > 0 ? 0 : order.length - 1) : (idx + delta + order.length) % order.length;
    select(order[next]);
  }

  /** Next terminal needing attention after the open one: questions first. */
  function nextAttention() {
    const list = [...$attention.questions, ...$attention.done].map((i) => i.key);
    if (list.length === 0) return toast("Rien à traiter.", "info", 1500);
    const idx = current ? list.indexOf(current) : -1;
    select(list[(idx + 1) % list.length]);
  }

  function newHere() {
    const item = $items.find((i) => i.key === current);
    if (item?.online) return createTerminal(item.session, item.meta?.cwd);
    const session = onlineSessions[0];
    if (session) createTerminal(session);
    else toast("Aucune machine en ligne.", "info", 2000);
  }

  function runShortcut(shortcut: Shortcut) {
    switch (shortcut.action) {
      case "palette":
        paletteOpen = !paletteOpen;
        break;
      case "attention":
        nextAttention();
        break;
      case "last": {
        const previous = history.find((k) => k !== current && $items.some((i) => i.key === k));
        if (previous) select(previous);
        break;
      }
      case "prev":
        step(-1);
        break;
      case "next":
        step(1);
        break;
      case "nth": {
        const key = order[(shortcut.n ?? 1) - 1];
        if (key) select(key);
        break;
      }
      case "new":
        newHere();
        break;
      case "rename":
        pane?.startRename();
        break;
      case "close":
        pane?.askClose();
        break;
    }
  }

  function onKeydown(event: KeyboardEvent) {
    learnKey(event);
    if (onboarding || mobile || $vaultStatus !== "unlocked" || $recording) return;
    const shortcut = matchShortcut(event);
    if (shortcut) {
      // Capture phase: the terminal never receives the key.
      event.preventDefault();
      event.stopPropagation();
      if (addingMachine || reconnecting || helpOpen) return;
      runShortcut(shortcut);
      return;
    }
    if (event.key === "?" && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const el = document.activeElement;
      const typing = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement;
      if (!typing) {
        helpOpen = true;
        event.preventDefault();
      }
    }
  }

  const unsubscribeVault = vaultStatus.subscribe((status) => {
    if (status === "unlocked") startLive();
  });
  const unsubscribeSelect = selectRequest.subscribe((key) => {
    if (key) {
      select(key);
      selectRequest.set(null);
    }
  });

  // Links from other pages: `/?terminal=<key>` or `/?newIn=<session>`.
  let pendingOpen: { key?: string; session?: string } | null = null;
  $: if (pendingOpen && $itemsReady) {
    const { key, session } = pendingOpen;
    const target = session ? $sessions.get(session) : undefined;
    if (key && $items.some((i) => i.key === key)) {
      pendingOpen = null;
      select(key);
    } else if (target?.online) {
      pendingOpen = null;
      createTerminal(target);
    }
  }

  let media: MediaQueryList;
  const onMedia = () => (mobile = media.matches);
  onMount(() => {
    const q = new URL(location.href).searchParams;
    if (q.get("terminal") || q.get("newIn")) {
      pendingOpen = { key: q.get("terminal") ?? undefined, session: q.get("newIn") ?? undefined };
      onboarding = false;
      goto("/", { replaceState: true, noScroll: true, keepFocus: true });
      setTimeout(() => (pendingOpen = null), 15_000);
    }
    refreshLayout();
    media = window.matchMedia("(max-width: 767px)");
    onMedia();
    media.addEventListener("change", onMedia);
  });
  onDestroy(() => {
    unsubscribeVault();
    unsubscribeSelect();
    media?.removeEventListener("change", onMedia);
  });

  // Sidebar resizing.
  let resizing = false;
  function startResize(event: PointerEvent) {
    resizing = true;
    const startX = event.clientX;
    const startWidth = $sidebarWidth;
    const move = (e: PointerEvent) => sidebarWidth.set(Math.min(520, Math.max(240, startWidth + e.clientX - startX)));
    const up = () => {
      resizing = false;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  function openFromWizard(key: string) {
    addingMachine = false;
    reconnecting = null;
    onboarding = false;
    select(key);
  }

  async function createFromWizard(session: Session) {
    addingMachine = false;
    reconnecting = null;
    onboarding = false;
    await createTerminal(session);
  }

  let wizardStarted = false;
  $: if ($loaded && onboarding === null) onboarding = $machines.size === 0;
  // A machine shared by a colleague ends the first run too.
  $: if (onboarding && !wizardStarted && $machines.size > 0) onboarding = false;
  $: firstRun = onboarding === true;
  $: neverSeen = [...$machines.values()].filter((m) => m.lastSeenAt === null && m.ownerId === $me?.user.id);
  $: onlineSessions = [...$sessions.values()].filter((s) => s.online);
  $: showSidebar = !mobile || !current;
  $: pending = [...$attention.questions, ...$attention.done];
</script>

<svelte:window on:keydown|capture={onKeydown} on:focus={refreshLayout} />

<VaultGate>
  {#if !$loaded}
    <div class="flex h-dvh items-center justify-center text-sm text-zinc-500">Chargement…</div>
  {:else if firstRun}
    <!-- First run: connect a machine. -->
    <div class="flex min-h-dvh items-start justify-center p-4 pt-[8vh]" data-testid="welcome">
      <div class="w-full max-w-[560px]">
        <div class="mb-5 flex justify-center"><Steps current={3} /></div>
        <div class="panel p-7">
          <h1 class="text-xl font-semibold text-zinc-50">Connectez votre première machine</h1>
          <p class="mt-2 text-[15px] leading-relaxed text-zinc-400">
            Votre PC, un serveur ou une machine de projet : une commande suffit. Ses terminaux apparaîtront ici,
            avec l'état de vos agents Claude.
          </p>
          <div class="mt-6"><AddMachine autoOpen on:created={() => (wizardStarted = true)} on:open={(e) => openFromWizard(e.detail)} on:create={(e) => createFromWizard(e.detail)} /></div>
        </div>
        <div class="mt-4 flex justify-center gap-2">
          <button class="btn-ghost text-sm" on:click={() => (onboarding = false)}>Passer cette étape</button>
          <button class="btn-ghost text-sm" on:click={logout}>Se déconnecter</button>
        </div>
      </div>
    </div>
  {:else}
    <div class="flex h-dvh min-h-0 overflow-hidden" class:select-none={resizing}>
      {#if showSidebar}
        <div class="relative h-full shrink-0 border-r border-zinc-800/80" style:width={mobile ? "100%" : `${$sidebarWidth}px`}>
          <Sidebar
            selected={current}
            touch={mobile}
            bind:order
            on:select={(e) => select(e.detail)}
            on:create={(e) => createTerminal(e.detail.session, e.detail.cwd)}
            on:action={(e) => onAction(e.detail.kind, e.detail.item)}
            on:addMachine={() => (addingMachine = true)}
            on:palette={() => (paletteOpen = true)}
            on:help={() => (helpOpen = true)}
            on:logout={logout}
            on:lock={lock}
          />
          {#if !mobile}
            <!-- svelte-ignore a11y-no-static-element-interactions -->
            <div
              class="absolute inset-y-0 -right-1 z-10 w-2 cursor-col-resize hover:bg-indigo-400/30"
              class:bg-indigo-400-30={resizing}
              title="Redimensionner"
              on:pointerdown|preventDefault={startResize}
              on:dblclick={() => sidebarWidth.set(300)}
            />
          {/if}
        </div>
      {/if}
      {#if !showSidebar || !mobile}
        <main class="flex min-w-0 flex-1">
          {#if current}
            {#key current}
              <div class="min-w-0 flex-1">
                <TerminalPane
                  bind:this={pane}
                  itemKey={current}
                  {mobile}
                  on:back={() => (current = null)}
                  on:closed={() => current && afterClose(current)}
                  on:create={(e) => createTerminal(e.detail.session, e.detail.meta?.cwd)}
                />
              </div>
            {/key}
          {:else}
            <div class="flex flex-1 items-center justify-center overflow-y-auto p-8" data-testid="empty-main">
              <div class="w-full max-w-lg">
                {#if pending.length > 0}
                  <h2 class="text-lg font-semibold text-zinc-100">À traiter</h2>
                  <div class="mt-3 space-y-1.5">
                    {#each pending as item (item.key)}
                      <button class="flex w-full items-start gap-3 rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-left transition-colors hover:border-zinc-700 hover:bg-zinc-800/80" on:click={() => select(item.key)}>
                        <div class="pt-0.5"><StatusBadge state={item.state} unread /></div>
                        <div class="min-w-0 flex-1">
                          <div class="flex items-baseline gap-2">
                            <span class="truncate text-[15px] font-medium text-zinc-100">{item.name}</span>
                            <span class="ml-auto shrink-0 text-xs text-zinc-500">{ago(item.since, $now)}</span>
                          </div>
                          {#if item.meta?.agent?.message}
                            <p class="mt-0.5 line-clamp-2 text-sm text-zinc-400">{item.meta.agent.message}</p>
                          {/if}
                        </div>
                      </button>
                    {/each}
                  </div>
                {:else if onlineSessions.length === 0}
                  <div class="text-center">
                    <div class="mb-4 flex justify-center text-zinc-600"><Icon name="monitor" size={40} stroke={1.5} /></div>
                    <h2 class="text-lg font-semibold text-zinc-100">Aucune machine en ligne</h2>
                    <p class="mx-auto mt-2 max-w-sm text-[15px] leading-relaxed text-zinc-400">
                      Lancez <code class="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[13px] text-zinc-200">sshx</code> sur une
                      machine déjà ajoutée, ou ajoutez-en une nouvelle.
                    </p>
                    <button class="btn-primary mt-5" on:click={() => (addingMachine = true)}><Icon name="plus" size={16} /> Ajouter une machine</button>
                    {#if neverSeen.length}
                      <div class="mx-auto mt-6 max-w-sm space-y-1.5 text-left">
                        <p class="text-xs font-medium text-zinc-500">Jamais connectées</p>
                        {#each neverSeen as m (m.id)}
                          <div class="flex items-center gap-2 rounded-lg border border-zinc-800 px-3 py-2">
                            <Icon name="monitor" size={15} class="text-zinc-500" />
                            <span class="min-w-0 flex-1 truncate text-sm text-zinc-200">{m.name}</span>
                            <button class="btn-ghost py-1 text-[13px]" on:click={() => (reconnecting = m)}>Afficher la commande</button>
                          </div>
                        {/each}
                      </div>
                    {/if}
                  </div>
                {:else}
                  <div class="text-center">
                    <div class="mb-4 flex justify-center"><Logo size={40} label={false} /></div>
                    <h2 class="text-lg font-semibold text-zinc-100">
                      {$items.length ? "Choisissez un terminal" : "Ouvrez votre premier terminal"}
                    </h2>
                    <div class="mt-4 flex flex-wrap justify-center gap-2">
                      {#each onlineSessions as s (s.name)}
                        <button class="btn" on:click={() => createTerminal(s)}>
                          <Icon name="plus" size={15} /> Terminal sur {$machines.get(s.machineId)?.name ?? s.hostname}
                        </button>
                      {/each}
                    </div>
                  </div>
                {/if}
                {#if !mobile}
                  <div class="mx-auto mt-10 w-fit">
                    <p class="mb-3 text-center text-xs font-medium text-zinc-500">Raccourcis clavier</p>
                    <ShortcutsHelp compact />
                  </div>
                {/if}
              </div>
            </div>
          {/if}
        </main>
      {/if}
    </div>
  {/if}
</VaultGate>

{#if reconnecting}
  <Modal title="Connecter {reconnecting.name}" on:close={() => (reconnecting = null)}>
    <AddMachine existing={reconnecting} on:open={(e) => openFromWizard(e.detail)} on:create={(e) => createFromWizard(e.detail)} />
  </Modal>
{/if}

{#if paletteOpen}
  <Palette
    {history}
    {current}
    on:select={(e) => select(e.detail)}
    on:create={(e) => {
      paletteOpen = false;
      createTerminal(e.detail);
    }}
    on:close={() => {
      paletteOpen = false;
      pane?.focus();
    }}
  />
{/if}

{#if helpOpen}
  <Modal title="Raccourcis clavier" width={640} on:close={() => !$recording && (helpOpen = false)}>
    <ShortcutsHelp editable />
  </Modal>
{/if}

{#if addingMachine}
  <Modal title="Ajouter une machine" on:close={() => (addingMachine = false)}>
    <AddMachine on:open={(e) => openFromWizard(e.detail)} on:create={(e) => createFromWizard(e.detail)}>
      <button slot="cancel" type="button" class="btn-ghost" on:click={() => (addingMachine = false)}>Annuler</button>
    </AddMachine>
  </Modal>
{/if}

<style>
  .bg-indigo-400-30 {
    background-color: rgb(129 140 248 / 0.3);
  }
</style>
