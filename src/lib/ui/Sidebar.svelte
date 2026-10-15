<!-- @component Terminal list, grouped by project or machine, sortable. -->
<script lang="ts">
  import { createEventDispatcher } from "svelte";

  import type { Session } from "$lib/api";
  import { me } from "$lib/auth";
  import { attention, lastSeen, needsAttention } from "$lib/notify";
  import { toastError } from "$lib/toast";
  import {
    eventsConnected,
    items,
    machines,
    NO_PROJECT,
    renameTerminal,
    sessions,
    setBell,
    setPinned,
    setSortKey,
    sortKeyBetween,
    type TermItem,
  } from "$lib/workspace";
  import { requestNotificationPermission } from "$lib/notify";
  import Menu, { type MenuItem } from "./Menu.svelte";
  import StatusBadge from "./StatusBadge.svelte";
  import TerminalRow from "./TerminalRow.svelte";

  export let selected: string[] = [];
  /** Keys in display order, for keyboard navigation. */
  export let order: string[] = [];

  const dispatch = createEventDispatcher<{
    select: { key: string; split: boolean };
    create: { session: Session; cwd?: string };
    action: { kind: "canvas" | "share" | "close" | "forget" | "split"; item: TermItem };
    logout: void;
    lock: void;
  }>();

  // Persisted view options.
  function persisted<T>(key: string, initial: T) {
    try {
      const v = localStorage.getItem(`sshx-platform:${key}`);
      return v ? (JSON.parse(v) as T) : initial;
    } catch {
      return initial;
    }
  }
  function persist(key: string, value: unknown) {
    try {
      localStorage.setItem(`sshx-platform:${key}`, JSON.stringify(value));
    } catch {
      /* ignore */
    }
  }

  let groupBy: "project" | "machine" = persisted("groupBy", "project");
  let collapsed: Record<string, boolean> = persisted("collapsed", {});
  let showOffline: boolean = persisted("showOffline", true);
  let filter: "all" | "attention" | "working" = "all";
  let query = "";
  $: persist("groupBy", groupBy);
  $: persist("collapsed", collapsed);
  $: persist("showOffline", showOffline);

  type Group = { id: string; title: string; subtitle?: string; items: TermItem[]; online: boolean; sessions: Session[] };

  const STATE_RANK: Record<string, number> = { permission: 5, question: 4, done: 3, working: 2, idle: 1, none: 0 };

  function matches(item: TermItem, q: string): boolean {
    if (!q) return true;
    const hay = [item.name, item.project, item.machine.name, item.meta?.cwd, item.meta?.git?.branch, item.session.hostname]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return q
      .toLowerCase()
      .split(/\s+/)
      .every((w) => hay.includes(w));
  }

  $: visible = $items.filter(
    (i) =>
      (showOffline || i.online) &&
      matches(i, query) &&
      (filter === "all" ||
        (filter === "working" && i.state === "working") ||
        (filter === "attention" && needsAttention(i, $lastSeen))),
  );
  $: pinned = visible.filter((i) => i.pinned);
  $: groups = buildGroups(visible.filter((i) => !i.pinned), groupBy, $sessions);
  $: onlineSessions = [...$sessions.values()].filter((s) => s.online);
  $: order = [...pinned, ...groups.flatMap((g) => (collapsed[g.id] ? [] : g.items))].map((i) => i.key);

  function buildGroups(list: TermItem[], by: typeof groupBy, allSessions: Map<string, Session>): Group[] {
    const map = new Map<string, Group>();
    for (const item of list) {
      const id = by === "project" ? `p:${item.project}` : `m:${item.machine.id}`;
      let g = map.get(id);
      if (!g) {
        g =
          by === "project"
            ? { id, title: item.project, items: [], online: false, sessions: [] }
            : {
                id,
                title: item.machine.name,
                subtitle: item.machine.kind === "project" ? item.machine.project ?? "projet" : undefined,
                items: [],
                online: false,
                sessions: [],
              };
        map.set(id, g);
      }
      g.items.push(item);
      g.online ||= item.online;
    }
    // Machines with an online session but no terminal yet.
    if (by === "machine" && !query && filter === "all") {
      for (const s of allSessions.values()) {
        if (!s.online) continue;
        const id = `m:${s.machineId}`;
        const machine = $machines.get(s.machineId);
        if (!machine) continue;
        if (!map.has(id)) map.set(id, { id, title: machine.name, items: [], online: true, sessions: [] });
      }
    }
    for (const g of map.values()) {
      const names = new Set(g.items.map((i) => i.session.name));
      g.sessions = [...allSessions.values()].filter(
        (s) => s.online && (names.has(s.name) || g.id === `m:${s.machineId}`),
      );
      g.online ||= g.sessions.length > 0;
    }
    return [...map.values()].sort((a, b) => {
      if (a.title === NO_PROJECT) return 1;
      if (b.title === NO_PROJECT) return -1;
      return a.title.localeCompare(b.title);
    });
  }

  function groupState(g: Group) {
    let best: TermItem | null = null;
    for (const i of g.items) {
      if (!i.online) continue;
      const rank = i.state === "done" && !needsAttention(i, $lastSeen) ? 0.5 : STATE_RANK[i.state];
      if (!best || rank > (STATE_RANK[best.state] ?? 0)) best = i;
    }
    return best;
  }

  function createIn(g: Group) {
    const item = g.items.find((i) => i.online);
    const session = item?.session ?? g.sessions[0];
    if (!session) return;
    const cwd = groupBy === "project" ? item?.meta?.git?.root ?? item?.meta?.cwd : undefined;
    dispatch("create", { session, cwd });
  }

  // Drag and drop reordering within a group.
  let dragKey: string | null = null;

  async function drop(list: TermItem[], target: TermItem, after: boolean) {
    if (!dragKey || dragKey === target.key) return;
    const dragged = $items.find((i) => i.key === dragKey);
    dragKey = null;
    if (!dragged) return;
    const others = list.filter((i) => i.key !== dragged.key);
    const idx = others.findIndex((i) => i.key === target.key);
    const before = after ? others[idx] : others[idx - 1];
    const next = after ? others[idx + 1] : others[idx];
    try {
      await setSortKey(dragged, sortKeyBetween(before, next));
    } catch (err) {
      toastError(err);
    }
  }

  // Context menu.
  let menu: { x: number; y: number; items: MenuItem[] } | null = null;
  let rows: Record<string, TerminalRow> = {};
  let newMenu: { x: number; y: number; items: MenuItem[] } | null = null;

  async function toggleBell(item: TermItem, on: boolean) {
    if (on) await requestNotificationPermission();
    setBell(item, on).catch(toastError);
  }

  function openMenu(item: TermItem, e: MouseEvent) {
    const list: MenuItem[] = [
      { label: "Ouvrir", run: () => dispatch("select", { key: item.key, split: false }) },
      { label: "Ouvrir à côté", hint: "Alt+clic", run: () => dispatch("select", { key: item.key, split: true }) },
      "separator",
      { label: "Renommer", hint: "double-clic", run: () => rows[item.key]?.startRename() },
      { label: item.pinned ? "Désépingler" : "Épingler", run: () => setPinned(item, !item.pinned).catch(toastError) },
      { label: item.bell ? "Couper les notifications" : "Me notifier", run: () => toggleBell(item, !item.bell) },
    ];
    if (item.customName) list.push({ label: "Revenir au nom automatique", run: () => renameTerminal(item, "").catch(toastError) });
    list.push("separator");
    if (item.online) {
      list.push(
        { label: "Voir la machine en canevas sshx", run: () => dispatch("action", { kind: "canvas", item }) },
        { label: "Copier le lien de partage sshx", run: () => dispatch("action", { kind: "share", item }) },
        "separator",
        { label: "Fermer le terminal", danger: true, run: () => dispatch("action", { kind: "close", item }) },
      );
    } else {
      list.push({ label: "Oublier cette session", danger: true, run: () => dispatch("action", { kind: "forget", item }) });
    }
    menu = { x: e.clientX, y: e.clientY, items: list };
  }

  function openNewMenu(e: MouseEvent) {
    const list: MenuItem[] = onlineSessions.map((s) => {
      const machine = $machines.get(s.machineId);
      return { label: machine?.name ?? s.hostname, hint: s.displayName, run: () => dispatch("create", { session: s }) };
    });
    if (list.length === 0) list.push({ label: "Aucune machine en ligne", run: () => {} });
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    newMenu = { x: rect.left, y: rect.bottom + 4, items: list };
  }
</script>

<aside class="flex h-full min-h-0 flex-col bg-zinc-900">
  <!-- Header -->
  <div class="flex items-center gap-2 px-3 pb-2 pt-3">
    <svg viewBox="0 0 32 32" class="h-5 w-5"><path d="M8 11l6 5-6 5" stroke="#818cf8" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round" /><path d="M16 22h8" stroke="#a1a1aa" stroke-width="2.5" stroke-linecap="round" /></svg>
    <span class="text-sm font-semibold text-zinc-100">sshx</span>
    <span
      class="h-1.5 w-1.5 rounded-full"
      class:bg-emerald-400={$eventsConnected}
      class:bg-zinc-600={!$eventsConnected}
      title={$eventsConnected ? "Temps réel connecté" : "Reconnexion…"}
    />
    <div class="flex-1" />
    <button class="btn px-2 py-0.5 text-xs" on:click={openNewMenu} title="Nouveau terminal">＋ Terminal</button>
  </div>

  <!-- Attention summary -->
  <div class="flex flex-wrap gap-1 px-3 pb-2 text-xs">
    <button class="rounded-full border px-2 py-0.5" class:border-zinc-500={filter === "all"} class:text-zinc-200={filter === "all"} class:border-zinc-700={filter !== "all"} class:text-zinc-500={filter !== "all"} on:click={() => (filter = "all")}>
      Tous
    </button>
    {#if $attention.total > 0 || filter === "attention"}
      <button class="rounded-full border px-2 py-0.5" class:border-amber-400={filter === "attention"} class:border-amber-900={filter !== "attention"} class:text-amber-300={true} on:click={() => (filter = filter === "attention" ? "all" : "attention")}>
        {#if $attention.questions.length}{$attention.questions.length} en attente{/if}{#if $attention.questions.length && $attention.done.length} · {/if}{#if $attention.done.length}{$attention.done.length} terminé{$attention.done.length > 1 ? "s" : ""}{/if}{#if $attention.total === 0}À traiter{/if}
      </button>
    {/if}
    {#if $attention.working.length > 0 || filter === "working"}
      <button class="rounded-full border px-2 py-0.5 text-indigo-300" class:border-indigo-400={filter === "working"} class:border-indigo-900={filter !== "working"} on:click={() => (filter = filter === "working" ? "all" : "working")}>
        {$attention.working.length} en cours
      </button>
    {/if}
    <button
      class="ml-auto rounded-full border px-2 py-0.5"
      class:border-zinc-600={showOffline}
      class:text-zinc-400={showOffline}
      class:border-zinc-800={!showOffline}
      class:text-zinc-600={!showOffline}
      title={showOffline ? "Masquer les sessions hors ligne" : "Afficher les sessions hors ligne"}
      on:click={() => (showOffline = !showOffline)}
    >
      hors ligne {showOffline ? "✓" : "✗"}
    </button>
  </div>

  <!-- Search and grouping -->
  <div class="flex items-center gap-1.5 px-3 pb-2">
    <input class="input py-1 text-xs" placeholder="Filtrer…" bind:value={query} />
    <div class="flex shrink-0 overflow-hidden rounded-md border border-zinc-700 text-xs">
      <button class="px-2 py-1" class:bg-zinc-700={groupBy === "project"} class:text-zinc-100={groupBy === "project"} class:text-zinc-500={groupBy !== "project"} on:click={() => (groupBy = "project")}>Projet</button>
      <button class="px-2 py-1" class:bg-zinc-700={groupBy === "machine"} class:text-zinc-100={groupBy === "machine"} class:text-zinc-500={groupBy !== "machine"} on:click={() => (groupBy = "machine")}>Machine</button>
    </div>
  </div>

  <!-- List -->
  <div class="min-h-0 flex-1 overflow-y-auto px-1.5 pb-4">
    {#if pinned.length}
      <div class="px-1.5 pb-0.5 pt-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Épinglés</div>
      {#each pinned as item (item.key)}
        <TerminalRow
          bind:this={rows[item.key]}
          {item}
          context={groupBy === "project" ? "machine" : "project"}
          selected={selected.includes(item.key)}
          on:select={(e) => dispatch("select", { key: item.key, split: e.detail.split })}
          on:rename={(e) => renameTerminal(item, e.detail).catch(toastError)}
          on:bell={(e) => toggleBell(item, e.detail)}
          on:pin={(e) => setPinned(item, e.detail).catch(toastError)}
          on:menu={(e) => openMenu(item, e.detail)}
          on:dragstart={() => (dragKey = item.key)}
          on:drop={(e) => drop(pinned, item, e.detail.after)}
        />
      {/each}
    {/if}

    {#each groups as group (group.id)}
      {@const top = groupState(group)}
      <div class="group/header mt-2 flex items-center gap-1.5 rounded px-1.5 py-0.5">
        <button
          class="flex min-w-0 flex-1 items-center gap-1.5 text-left"
          on:click={() => (collapsed = { ...collapsed, [group.id]: !collapsed[group.id] })}
        >
          <span class="w-2 text-[10px] text-zinc-500">{collapsed[group.id] ? "▸" : "▾"}</span>
          <span class="truncate text-[11px] font-semibold uppercase tracking-wide" class:text-zinc-400={group.online} class:text-zinc-600={!group.online}>
            {group.title}
          </span>
          {#if group.subtitle}<span class="truncate text-[11px] text-zinc-600">{group.subtitle}</span>{/if}
          <span class="text-[11px] text-zinc-600">{group.items.length}</span>
          {#if collapsed[group.id] && top && top.state !== "none"}
            <StatusBadge state={top.state} unread={needsAttention(top, $lastSeen)} />
          {/if}
        </button>
        {#if group.sessions.length}
          <button
            class="rounded px-1 text-xs text-zinc-500 opacity-0 hover:text-zinc-200 group-hover/header:opacity-100"
            title={groupBy === "project" ? "Nouveau terminal dans ce projet" : "Nouveau terminal sur cette machine"}
            on:click={() => createIn(group)}
          >
            ＋
          </button>
        {/if}
      </div>
      {#if !collapsed[group.id]}
        {#each group.items as item (item.key)}
          <TerminalRow
            bind:this={rows[item.key]}
            {item}
            context={groupBy === "project" ? "machine" : "project"}
            selected={selected.includes(item.key)}
            on:select={(e) => dispatch("select", { key: item.key, split: e.detail.split })}
            on:rename={(e) => renameTerminal(item, e.detail).catch(toastError)}
            on:bell={(e) => toggleBell(item, e.detail)}
            on:pin={(e) => setPinned(item, e.detail).catch(toastError)}
            on:menu={(e) => openMenu(item, e.detail)}
            on:dragstart={() => (dragKey = item.key)}
            on:drop={(e) => drop(group.items, item, e.detail.after)}
          />
        {/each}
        {#if group.items.length === 0}
          <button class="ml-5 py-1 text-xs text-zinc-500 hover:text-zinc-300" on:click={() => createIn(group)}>＋ Ouvrir un terminal</button>
        {/if}
      {/if}
    {/each}

    {#if $items.length === 0}
      <div class="px-3 py-6 text-sm text-zinc-500">
        {#if onlineSessions.length}
          Aucun terminal ouvert. Utilisez « ＋ Terminal ».
        {:else}
          Aucune machine connectée. Ajoutez-en une depuis <a class="text-indigo-300 underline" href="/machines">Machines</a>.
        {/if}
      </div>
    {/if}
  </div>

  <!-- Footer -->
  <div class="flex shrink-0 items-center gap-2.5 whitespace-nowrap border-t border-zinc-800 px-3 py-2 text-xs text-zinc-500">
    <span class="min-w-0 flex-1 truncate" title={$me?.user.username}>{$me?.user.displayName}</span>
    <a class="hover:text-zinc-200" href="/machines">Machines</a>
    {#if $me?.user.isAdmin}<a class="hover:text-zinc-200" href="/admin">Admin</a>{/if}
    <button class="hover:text-zinc-200" title="Verrouiller le chiffrement sur cet appareil" on:click={() => dispatch("lock")}>⏻</button>
    <button class="hover:text-zinc-200" on:click={() => dispatch("logout")}>Sortir</button>
  </div>
</aside>

{#if menu}
  <Menu x={menu.x} y={menu.y} items={menu.items} on:close={() => (menu = null)} />
{/if}
{#if newMenu}
  <Menu x={newMenu.x} y={newMenu.y} items={newMenu.items} on:close={() => (newMenu = null)} />
{/if}
