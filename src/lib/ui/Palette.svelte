<!--
  @component "Aller à" (⌥K): type a few letters of a terminal's name, project,
  machine or branch, then Enter. Empty, it lists recent terminals first.
-->
<script lang="ts">
  import { createEventDispatcher, onMount } from "svelte";

  import type { Session } from "$lib/api";
  import { lastSeen, needsAttention } from "$lib/notify";
  import { shortcutLabels } from "$lib/shortcuts";
  import { ago, now } from "$lib/time";
  import { items, machines, sessions, type TermItem } from "$lib/workspace";
  import Icon from "./Icon.svelte";
  import StatusBadge, { STATE_LABELS } from "./StatusBadge.svelte";

  /** Recently opened terminals, most recent first. */
  export let history: string[] = [];
  /** Currently open terminal. */
  export let current: string | null = null;

  const dispatch = createEventDispatcher<{ select: string; create: Session; close: void }>();
  const LIMIT = 12;

  type Entry = { kind: "terminal"; item: TermItem } | { kind: "create"; session: Session; label: string };

  let query = "";
  let selected = 0;
  let input: HTMLInputElement;
  let list: HTMLDivElement;

  onMount(() => input.focus());

  function haystack(item: TermItem): string {
    return [item.name, item.project, item.machine.name, item.meta?.git?.branch, item.meta?.cwd, item.meta?.agent?.message]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
  }

  function score(item: TermItem, words: string[]): number {
    const hay = haystack(item);
    if (!words.every((w) => hay.includes(w))) return -1;
    const name = item.name.toLowerCase();
    let s = 0;
    for (const w of words) {
      if (name.startsWith(w)) s += 4;
      else if (name.includes(w)) s += 2;
      else s += 1;
    }
    return s + (item.online ? 1 : 0);
  }

  function recency(key: string): number {
    const idx = history.indexOf(key);
    return idx < 0 ? Infinity : idx;
  }

  $: entries = build(query, $items, history);

  function build(q: string, all: TermItem[], _history: string[]): Entry[] {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    let terminals: TermItem[];
    if (words.length === 0) {
      // Recent first (the current one last, it is already open), then the rest.
      terminals = [...all].sort((a, b) => {
        const ra = a.key === current ? history.length : recency(a.key);
        const rb = b.key === current ? history.length : recency(b.key);
        if (ra !== rb) return ra < rb ? -1 : 1;
        return Number(b.online) - Number(a.online);
      });
    } else {
      terminals = all
        .map((item) => ({ item, s: score(item, words) }))
        .filter((x) => x.s >= 0)
        .sort((a, b) => b.s - a.s || recency(a.item.key) - recency(b.item.key))
        .map((x) => x.item);
    }
    const out: Entry[] = terminals.slice(0, LIMIT).map((item) => ({ kind: "terminal", item }));
    for (const session of $sessions.values()) {
      if (!session.online) continue;
      const machine = $machines.get(session.machineId)?.name ?? session.hostname;
      const label = `Nouveau terminal sur ${machine}`;
      if (words.every((w) => label.toLowerCase().includes(w) || "nouveau terminal".includes(w))) {
        out.push({ kind: "create", session, label });
      }
    }
    return out;
  }

  $: if (selected >= entries.length) selected = Math.max(0, entries.length - 1);
  $: query, (selected = 0);

  function choose(entry: Entry | undefined) {
    if (!entry) return;
    if (entry.kind === "terminal") dispatch("select", entry.item.key);
    else dispatch("create", entry.session);
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (event.altKey) return;
      const delta = event.key === "ArrowDown" ? 1 : -1;
      selected = (selected + delta + entries.length) % Math.max(1, entries.length);
      list?.querySelector(`[data-index="${selected}"]`)?.scrollIntoView({ block: "nearest" });
      event.preventDefault();
    } else if (event.key === "Enter") {
      choose(entries[selected]);
      event.preventDefault();
    } else if (event.key === "Escape") {
      dispatch("close");
      event.preventDefault();
    }
  }

  function subtitle(item: TermItem): string {
    return [item.machine.name, item.project !== item.name ? item.project : null, item.meta?.git?.branch].filter(Boolean).join(" · ");
  }
</script>

<div class="fixed inset-0 z-40 flex items-start justify-center bg-black/50 p-4 pt-[12vh]" data-testid="palette">
  <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
  <div class="absolute inset-0" on:click={() => dispatch("close")} />
  <div class="relative w-full max-w-[600px] overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl shadow-black/60" role="dialog" aria-label="Aller à un terminal">
    <div class="flex items-center gap-3 border-b border-zinc-800 px-4">
      <Icon name="search" size={18} class="text-zinc-500" />
      <input
        bind:this={input}
        bind:value={query}
        class="h-14 min-w-0 flex-1 bg-transparent text-[16px] text-zinc-100 outline-none placeholder:text-zinc-500"
        placeholder="Aller à un terminal…"
        aria-label="Rechercher un terminal"
        on:keydown={onKeydown}
      />
      <span class="kbd">Échap</span>
    </div>
    <div bind:this={list} class="max-h-[min(60vh,520px)] overflow-y-auto p-1.5" role="listbox">
      {#each entries as entry, i}
        <button
          class="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left"
          class:bg-zinc-800={i === selected}
          role="option"
          aria-selected={i === selected}
          data-index={i}
          data-testid="palette-entry"
          on:mousemove={() => (selected = i)}
          on:click={() => choose(entry)}
        >
          {#if entry.kind === "terminal"}
            {@const item = entry.item}
            <StatusBadge state={item.state} online={item.online} unread={needsAttention(item, $lastSeen) && item.state === "done"} />
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2">
                <span class="truncate text-[15px] text-zinc-100" class:font-semibold={needsAttention(item, $lastSeen)}>{item.name}</span>
                {#if item.key === current}<span class="shrink-0 text-xs text-zinc-500">ouvert</span>{/if}
              </div>
              <div class="truncate font-mono text-xs text-zinc-500">{subtitle(item)}</div>
            </div>
            {#if item.online && item.state !== "none"}
              <span class="shrink-0 text-xs text-zinc-500">{STATE_LABELS[item.state]} · {ago(item.since, $now)}</span>
            {:else if !item.online}
              <span class="shrink-0 text-xs text-zinc-600">hors ligne</span>
            {/if}
          {:else}
            <span class="flex h-[18px] w-[18px] items-center justify-center text-zinc-400"><Icon name="plus" size={16} /></span>
            <span class="min-w-0 flex-1 truncate text-[15px] text-zinc-300">{entry.label}</span>
          {/if}
        </button>
      {:else}
        <p class="px-3 py-6 text-center text-sm text-zinc-500">Aucun terminal ne correspond.</p>
      {/each}
    </div>
    <div class="flex flex-wrap gap-x-4 gap-y-1 border-t border-zinc-800 px-4 py-2 text-xs text-zinc-500">
      <span><span class="kbd">↑</span> <span class="kbd">↓</span> choisir</span>
      <span><span class="kbd">Entrée</span> ouvrir</span>
      <span><span class="kbd">{$shortcutLabels.attention}</span> suivant à traiter</span>
      <span><span class="kbd">{$shortcutLabels.last}</span> précédent</span>
    </div>
  </div>
</div>
