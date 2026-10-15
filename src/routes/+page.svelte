<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { goto } from "$app/navigation";

  import { api, type Session } from "$lib/api";
  import { me } from "$lib/auth";
  import { acquire, closeAll, release } from "$lib/connection";
  import { attention, markSeen, selectRequest, visibleKeys } from "$lib/notify";
  import { toastError } from "$lib/toast";
  import Sidebar from "$lib/ui/Sidebar.svelte";
  import StatusBadge from "$lib/ui/StatusBadge.svelte";
  import TerminalPane from "$lib/ui/TerminalPane.svelte";
  import VaultGate from "$lib/ui/VaultGate.svelte";
  import { lockVault, vaultStatus } from "$lib/vault";
  import { connectEvents, items, itemsReady, loadWorkspace, termKey, type TermItem } from "$lib/workspace";

  const MAX_PANES = 3;
  const PANES_KEY = "sshx-platform:panes";

  let panes: string[] = [];
  let active = 0;
  let order: string[] = [];
  let mobile = false;
  let paneRefs: TerminalPane[] = [];

  try {
    panes = JSON.parse(localStorage.getItem(PANES_KEY) ?? "[]");
  } catch {
    panes = [];
  }
  $: try {
    localStorage.setItem(PANES_KEY, JSON.stringify(panes));
  } catch {
    /* ignore */
  }
  // Drop panes of terminals that no longer exist, once loaded.
  $: if ($itemsReady) {
    const keys = new Set($items.map((i) => i.key));
    const kept = panes.filter((k) => keys.has(k) || pendingKeys.has(k));
    if (kept.length !== panes.length) {
      panes = kept;
      active = Math.min(active, Math.max(0, panes.length - 1));
    }
  }
  $: visibleKeys.set(new Set(mobile && panes.length ? [panes[active]] : panes));
  $: for (const key of panes) markSeen(key);

  const pendingKeys = new Set<string>();

  function select(key: string, split = false) {
    const idx = panes.indexOf(key);
    if (idx >= 0) {
      active = idx;
    } else if (split && panes.length < MAX_PANES && !mobile) {
      panes = [...panes, key];
      active = panes.length - 1;
    } else if (panes.length === 0) {
      panes = [key];
      active = 0;
    } else {
      panes[active] = key;
      panes = panes;
    }
    markSeen(key);
    setTimeout(() => {
      // Do not steal focus from a field, e.g. the rename box of a double-click.
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return;
      paneRefs[active]?.focus();
    }, 50);
  }

  function closePane(i: number) {
    panes = panes.filter((_, j) => j !== i);
    active = Math.min(active, Math.max(0, panes.length - 1));
  }

  function shellQuote(path: string) {
    return `'${path.replace(/'/g, `'\\''`)}'`;
  }

  async function createTerminal(session: Session, cwd?: string, split = false) {
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
        select(key, split);
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
        const idx = panes.indexOf(item.key);
        if (idx >= 0) closePane(idx);
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
    await api.logout().catch(() => {});
    me.set(null);
    await goto("/login");
  }

  async function lock() {
    closeAll();
    await lockVault();
  }

  function onKeydown(event: KeyboardEvent) {
    // Alt+↑/↓: previous/next terminal; Alt+1..9: n-th terminal.
    if (!event.altKey || event.metaKey || event.ctrlKey) return;
    const current = panes[active];
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (order.length === 0) return;
      const idx = order.indexOf(current);
      const next = event.key === "ArrowDown" ? idx + 1 : idx - 1;
      select(order[(next + order.length) % order.length]);
      event.preventDefault();
    } else if (/^Digit[1-9]$/.test(event.code)) {
      const key = order[Number(event.code.slice(5)) - 1];
      if (key) select(key);
      event.preventDefault();
    }
  }

  let stopEvents: (() => void) | null = null;
  const unsubscribeVault = vaultStatus.subscribe((status) => {
    if (status === "unlocked" && !stopEvents) {
      loadWorkspace().catch(toastError);
      stopEvents = connectEvents();
    }
  });
  const unsubscribeSelect = selectRequest.subscribe((key) => {
    if (key) {
      select(key);
      selectRequest.set(null);
    }
  });

  let media: MediaQueryList;
  const onMedia = () => (mobile = media.matches);
  onMount(() => {
    media = window.matchMedia("(max-width: 767px)");
    onMedia();
    media.addEventListener("change", onMedia);
    if (mobile && panes.length > 1) panes = [panes[active] ?? panes[0]];
  });
  onDestroy(() => {
    stopEvents?.();
    unsubscribeVault();
    unsubscribeSelect();
    media?.removeEventListener("change", onMedia);
  });

  $: showSidebar = !mobile || panes.length === 0;
  $: shownPanes = mobile ? panes.slice(active, active + 1) : panes;
</script>

<svelte:window on:keydown={onKeydown} />

<VaultGate>
  <div class="flex h-dvh min-h-0 overflow-hidden">
    {#if showSidebar}
      <div class="h-full shrink-0 border-r border-zinc-800" class:w-72={!mobile} class:w-full={mobile}>
        <Sidebar
          selected={panes}
          bind:order
          on:select={(e) => select(e.detail.key, e.detail.split)}
          on:create={(e) => createTerminal(e.detail.session, e.detail.cwd)}
          on:action={(e) => onAction(e.detail.kind, e.detail.item)}
          on:logout={logout}
          on:lock={lock}
        />
      </div>
    {/if}
    {#if !showSidebar || !mobile}
      <main class="flex min-w-0 flex-1">
        {#each shownPanes as key, i (key)}
          {@const idx = mobile ? active : i}
          <!-- svelte-ignore a11y-no-static-element-interactions -->
          <div
            class="min-w-0 flex-1 border-l border-zinc-800 first:border-l-0"
            class:ring-1={!mobile && panes.length > 1 && idx === active}
            class:ring-inset={true}
            class:ring-indigo-500={!mobile && panes.length > 1 && idx === active}
            on:pointerdown={() => (active = idx)}
          >
            <TerminalPane
              bind:this={paneRefs[idx]}
              itemKey={key}
              {mobile}
              active={idx === active}
              canSplit={panes.length < MAX_PANES}
              closable={panes.length > 1}
              on:back={() => (panes = [])}
              on:closePane={() => closePane(idx)}
              on:split={() => {
                const next = order.find((k) => !panes.includes(k));
                if (next) select(next, true);
              }}
              on:create={(e) => createTerminal(e.detail.session, e.detail.meta?.cwd, panes.length < MAX_PANES)}
            />
          </div>
        {/each}
        {#if panes.length === 0}
          <div class="flex flex-1 items-center justify-center p-8">
            <div class="max-w-md text-sm text-zinc-500">
              <p class="text-zinc-300">Choisissez un terminal dans la liste.</p>
              <p class="mt-1">Alt+↑/↓ pour naviguer, Alt+clic pour ouvrir à côté, double-clic pour renommer.</p>
              {#if $attention.total > 0}
                <div class="mt-6 space-y-1">
                  <p class="text-xs font-semibold uppercase tracking-wide text-zinc-500">À traiter</p>
                  {#each [...$attention.questions, ...$attention.done] as item (item.key)}
                    <button class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-zinc-800" on:click={() => select(item.key)}>
                      <StatusBadge state={item.state} unread />
                      <span class="truncate text-zinc-200">{item.name}</span>
                      <span class="truncate text-xs text-zinc-500">{item.meta?.agent?.message ?? ""}</span>
                    </button>
                  {/each}
                </div>
              {/if}
            </div>
          </div>
        {/if}
      </main>
    {/if}
  </div>
</VaultGate>
