<!-- @component Terminal list, grouped by project or machine, sortable. -->
<script lang="ts">
  import { createEventDispatcher } from "svelte";
  import { goto } from "$app/navigation";

  import type { Session } from "$lib/api";
  import { me } from "$lib/auth";
  import { attention, lastSeen, needsAttention, requestNotificationPermission } from "$lib/notify";
  import { shortcutLabels } from "$lib/shortcuts";
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
  import Icon from "./Icon.svelte";
  import Logo from "./Logo.svelte";
  import Menu, { type MenuItem } from "./Menu.svelte";
  import StatusBadge from "./StatusBadge.svelte";
  import TerminalRow from "./TerminalRow.svelte";

  /** Key of the open terminal. */
  export let selected: string | null = null;
  /** Keys in display order, for keyboard navigation. */
  export let order: string[] = [];
  /** Touch layout (phones). */
  export let touch = false;

  const dispatch = createEventDispatcher<{
    select: string;
    create: { session: Session; cwd?: string };
    action: { kind: "canvas" | "share" | "close" | "forget"; item: TermItem };
    addMachine: void;
    palette: void;
    help: void;
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
  $: persist("groupBy", groupBy);
  $: persist("collapsed", collapsed);
  $: persist("showOffline", showOffline);

  type Group = { id: string; title: string; subtitle?: string; items: TermItem[]; online: boolean; sessions: Session[] };

  const STATE_RANK: Record<string, number> = { permission: 5, question: 4, done: 3, working: 2, idle: 1, none: 0 };

  $: visible = $items.filter(
    (i) =>
      (showOffline || i.online) &&
      (filter === "all" ||
        (filter === "working" && i.state === "working") ||
        (filter === "attention" && needsAttention(i, $lastSeen))),
  );
  $: pinned = visible.filter((i) => i.pinned);
  $: groups = buildGroups(visible.filter((i) => !i.pinned), groupBy, $sessions);
  $: onlineSessions = [...$sessions.values()].filter((s) => s.online);
  $: order = [...pinned, ...groups.flatMap((g) => (collapsed[g.id] ? [] : g.items))].map((i) => i.key);
  $: offlineCount = $items.filter((i) => !i.online).length;

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
    if (by === "machine" && filter === "all") {
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
      g.sessions = [...allSessions.values()].filter((s) => s.online && (names.has(s.name) || g.id === `m:${s.machineId}`));
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

  // Menus.
  let menu: { x: number; y: number; items: MenuItem[]; alignRight?: boolean; above?: boolean } | null = null;
  let rows: Record<string, TerminalRow> = {};

  // The name and the labelled "Terminal" button need about 285px (Inter is bundled).
  let headerWidth = 300;
  $: narrowHeader = headerWidth < 292;

  async function toggleBell(item: TermItem, on: boolean) {
    if (on) await requestNotificationPermission();
    setBell(item, on).catch(toastError);
  }

  function machineName(s: Session) {
    return $machines.get(s.machineId)?.name ?? s.hostname;
  }

  function openRowMenu(item: TermItem, pos: { x: number; y: number }) {
    const list: MenuItem[] = [{ label: "Ouvrir", icon: "terminal", run: () => dispatch("select", item.key) }];
    list.push(
      "separator",
      { label: "Renommer", icon: "edit", hint: touch ? undefined : "double-clic", run: () => rows[item.key]?.startRename() },
      { label: item.pinned ? "Désépingler" : "Épingler en haut", icon: "pin", run: () => setPinned(item, !item.pinned).catch(toastError) },
      { label: item.bell ? "Couper les notifications" : "Me notifier", icon: "bell", run: () => toggleBell(item, !item.bell) },
    );
    if (item.customName) list.push({ label: "Revenir au nom automatique", icon: "refresh", run: () => renameTerminal(item, "").catch(toastError) });
    list.push("separator");
    if (item.online) {
      list.push(
        { label: "Voir la machine en canevas sshx", icon: "canvas", run: () => dispatch("action", { kind: "canvas", item }) },
        { label: "Copier le lien sshx", icon: "share", run: () => dispatch("action", { kind: "share", item }) },
        "separator",
        { label: "Fermer le terminal", icon: "x", danger: true, run: () => rows[item.key]?.askClose() },
      );
    } else {
      list.push({ label: "Oublier cette session", icon: "trash", danger: true, run: () => dispatch("action", { kind: "forget", item }) });
    }
    menu = { x: pos.x, y: pos.y, items: list, alignRight: true };
  }

  function newTerminal(e: MouseEvent) {
    if (onlineSessions.length === 1) {
      dispatch("create", { session: onlineSessions[0] });
      return;
    }
    const list: MenuItem[] = [];
    if (onlineSessions.length) {
      list.push({ heading: "Nouveau terminal sur" });
      for (const s of onlineSessions) list.push({ label: machineName(s), icon: "monitor", hint: s.hostname, run: () => dispatch("create", { session: s }) });
      list.push("separator");
    } else {
      list.push({ label: "Aucune machine en ligne", disabled: true, run: () => {} }, "separator");
    }
    list.push({ label: "Ajouter une machine…", icon: "plus", run: () => dispatch("addMachine") });
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    menu = { x: rect.right, y: rect.bottom + 6, items: list, alignRight: true };
  }

  function viewMenu(e: MouseEvent) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    menu = {
      x: rect.right,
      y: rect.bottom + 6,
      alignRight: true,
      items: [
        { heading: "Grouper par" },
        { label: "Projet", icon: "folder", hint: groupBy === "project" ? "✓" : "", run: () => (groupBy = "project") },
        { label: "Machine", icon: "monitor", hint: groupBy === "machine" ? "✓" : "", run: () => (groupBy = "machine") },
        "separator",
        {
          label: showOffline ? "Masquer les sessions hors ligne" : "Afficher les sessions hors ligne",
          icon: showOffline ? "eyeOff" : "eye",
          hint: offlineCount ? String(offlineCount) : "",
          run: () => (showOffline = !showOffline),
        },
      ],
    };
  }

  function userMenu(e: MouseEvent) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const list: MenuItem[] = [
      { heading: $me?.user.username ?? "" },
      { label: "Machines", icon: "monitor", run: () => goto("/machines") },
      { label: "Ajouter une machine…", icon: "plus", run: () => dispatch("addMachine") },
    ];
    if ($me?.user.isAdmin) list.push({ label: "Administration", icon: "users", run: () => goto("/admin") });
    if (!touch) list.push({ label: "Raccourcis clavier", icon: "text", hint: "?", run: () => dispatch("help") });
    list.push(
      "separator",
      { label: "Verrouiller cet appareil", icon: "lock", run: () => dispatch("lock") },
      { label: "Se déconnecter", icon: "logout", run: () => dispatch("logout") },
    );
    menu = { x: rect.left, y: rect.top - 6, items: list, above: true };
  }

  $: initials = ($me?.user.displayName ?? "?")
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
</script>

<aside class="flex h-full min-h-0 flex-col bg-zinc-950" data-testid="sidebar">
  <!-- Header -->
  <div class="flex h-14 shrink-0 items-center gap-2 px-4" bind:clientWidth={headerWidth}>
    <Logo size={26}>
      <span
        class="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-zinc-950"
        class:bg-emerald-400={$eventsConnected}
        class:bg-zinc-600={!$eventsConnected}
        title={$eventsConnected ? "Temps réel connecté" : "Reconnexion…"}
      />
    </Logo>
    <div class="flex-1" />
    <button
      class="btn-primary py-1.5"
      class:px-2.5={!narrowHeader}
      class:px-2={narrowHeader}
      on:click={newTerminal}
      title="Nouveau terminal ({$shortcutLabels.new})"
      aria-label="Nouveau terminal"
      data-testid="new-terminal"
    >
      <Icon name="plus" size={16} stroke={2.4} />
      {#if !narrowHeader}Terminal{/if}
    </button>
  </div>

  <!-- Quick switch and view options -->
  <div class="flex items-center gap-1.5 px-3 pb-2">
    <button
      class="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 text-left text-sm text-zinc-500 transition-colors hover:border-zinc-700 hover:text-zinc-300"
      on:click={() => dispatch("palette")}
      data-testid="open-palette"
    >
      <Icon name="search" size={15} />
      <span class="min-w-0 flex-1 truncate">Aller à un terminal…</span>
      {#if !touch}<span class="kbd">{$shortcutLabels.palette}</span>{/if}
    </button>
    <button class="icon-btn h-9 w-9" title="Affichage" aria-label="Options d'affichage" on:click={viewMenu}>
      <Icon name="settings" size={17} />
    </button>
  </div>

  <!-- Attention filters, shown only when useful -->
  {#if $attention.total > 0 || $attention.working.length > 0 || filter !== "all"}
    <div class="flex flex-wrap gap-1.5 px-3 pb-2 text-[13px]">
      {#if $attention.total > 0 || filter === "attention"}
        <button
          class="rounded-full border px-2.5 py-1 font-medium transition-colors"
          class:border-amber-400={filter === "attention"}
          class:bg-amber-400-10={filter === "attention"}
          class:border-amber-800={filter !== "attention"}
          class:text-amber-200={true}
          data-testid="filter-attention"
          on:click={() => (filter = filter === "attention" ? "all" : "attention")}
        >
          {$attention.total} à traiter
        </button>
      {/if}
      {#if $attention.working.length > 0 || filter === "working"}
        <button
          class="rounded-full border px-2.5 py-1 font-medium text-indigo-200 transition-colors"
          class:border-indigo-400={filter === "working"}
          class:border-indigo-800={filter !== "working"}
          on:click={() => (filter = filter === "working" ? "all" : "working")}
        >
          {$attention.working.length} en cours
        </button>
      {/if}
      {#if filter !== "all"}
        <button class="rounded-full px-2 py-1 text-zinc-400 hover:text-zinc-100" on:click={() => (filter = "all")}>Tout afficher</button>
      {/if}
    </div>
  {/if}

  <!-- List -->
  <nav class="min-h-0 flex-1 overflow-y-auto px-2 pb-4" aria-label="Terminaux">
    {#if pinned.length}
      <div class="px-2.5 pb-1 pt-3 text-xs font-semibold text-zinc-500">Épinglés</div>
      {#each pinned as item (item.key)}
        <TerminalRow
          bind:this={rows[item.key]}
          {item}
          {touch}
          context={groupBy === "project" ? "machine" : "project"}
          selected={selected === item.key}
          on:select={() => dispatch("select", item.key)}
          on:rename={(e) => renameTerminal(item, e.detail).catch(toastError)}
          on:bell={(e) => toggleBell(item, e.detail)}
          on:pin={(e) => setPinned(item, e.detail).catch(toastError)}
          on:menu={(e) => openRowMenu(item, e.detail)}
          on:close={() => dispatch("action", { kind: "close", item })}
          on:dragstart={() => (dragKey = item.key)}
          on:drop={(e) => drop(pinned, item, e.detail.after)}
        />
      {/each}
    {/if}

    {#each groups as group (group.id)}
      {@const top = groupState(group)}
      <div class="group/header mt-3 flex items-center gap-1 rounded-md pl-1 pr-1" data-testid="group" data-title={group.title}>
        <button
          class="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1 py-1 text-left hover:text-zinc-100"
          on:click={() => (collapsed = { ...collapsed, [group.id]: !collapsed[group.id] })}
          aria-expanded={!collapsed[group.id]}
        >
          <Icon name={collapsed[group.id] ? "chevronRight" : "chevronDown"} size={14} class="text-zinc-500" />
          <Icon name={groupBy === "project" ? "folder" : "monitor"} size={14} class={group.online ? "text-zinc-400" : "text-zinc-600"} />
          <span class="truncate text-[13px] font-semibold" class:text-zinc-300={group.online} class:text-zinc-500={!group.online}>
            {group.title}
          </span>
          {#if group.subtitle}<span class="truncate text-xs text-zinc-500">{group.subtitle}</span>{/if}
          <span class="text-xs text-zinc-600">{group.items.length}</span>
          {#if collapsed[group.id] && top && top.state !== "none"}
            <StatusBadge state={top.state} unread={needsAttention(top, $lastSeen)} />
          {/if}
        </button>
        {#if group.sessions.length}
          <button
            class="flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-800 hover:text-zinc-100 group-hover/header:opacity-100"
            class:opacity-0={!touch}
            title={groupBy === "project" ? "Nouveau terminal dans ce projet" : "Nouveau terminal sur cette machine"}
            aria-label="Nouveau terminal ici"
            on:click={() => createIn(group)}
          >
            <Icon name="plus" size={15} />
          </button>
        {/if}
      </div>
      {#if !collapsed[group.id]}
        {#each group.items as item (item.key)}
          <TerminalRow
            bind:this={rows[item.key]}
            {item}
            {touch}
            context={groupBy === "project" ? "machine" : "project"}
            selected={selected === item.key}
            on:select={() => dispatch("select", item.key)}
            on:rename={(e) => renameTerminal(item, e.detail).catch(toastError)}
            on:bell={(e) => toggleBell(item, e.detail)}
            on:pin={(e) => setPinned(item, e.detail).catch(toastError)}
            on:menu={(e) => openRowMenu(item, e.detail)}
          on:close={() => dispatch("action", { kind: "close", item })}
            on:dragstart={() => (dragKey = item.key)}
            on:drop={(e) => drop(group.items, item, e.detail.after)}
          />
        {/each}
        {#if group.items.length === 0}
          <button class="btn-ghost ml-6 mt-0.5 text-[13px]" on:click={() => createIn(group)}>
            <Icon name="plus" size={14} /> Ouvrir un terminal
          </button>
        {/if}
      {/if}
    {/each}

    {#if $items.length === 0}
      <div class="px-3 py-8 text-center text-sm leading-relaxed text-zinc-500">
        {#if onlineSessions.length}
          Aucun terminal ouvert.<br />Cliquez sur « Terminal » pour en ouvrir un.
        {:else}
          Aucune machine en ligne.
        {/if}
      </div>
    {:else if visible.length === 0}
      <div class="px-3 py-8 text-center text-sm text-zinc-500">Aucun terminal dans ce filtre.</div>
    {/if}
  </nav>

  <!-- Footer -->
  <div class="flex shrink-0 items-center gap-2 border-t border-zinc-800/80 px-2 py-2">
    <button class="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-zinc-900" on:click={userMenu} data-testid="user-menu">
      <span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-indigo-500/20 text-xs font-semibold text-indigo-200">{initials}</span>
      <span class="min-w-0 flex-1 truncate text-sm text-zinc-300">{$me?.user.displayName}</span>
      <Icon name="more" size={16} stroke={2.6} class="text-zinc-500" />
    </button>
  </div>
</aside>

{#if menu}
  <Menu x={menu.x} y={menu.y} items={menu.items} alignRight={menu.alignRight} above={menu.above} on:close={() => (menu = null)} />
{/if}

<style>
  .bg-amber-400-10 {
    background-color: rgb(251 191 36 / 0.1);
  }
</style>
