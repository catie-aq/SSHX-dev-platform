<!-- @component One terminal in the sidebar. -->
<script lang="ts">
  import { createEventDispatcher, tick } from "svelte";

  import { lastSeen, needsAttention } from "$lib/notify";
  import { ago, now } from "$lib/time";
  import type { TermItem } from "$lib/workspace";
  import Icon from "./Icon.svelte";
  import StatusBadge from "./StatusBadge.svelte";

  export let item: TermItem;
  export let selected = false;
  /** What to show under the name: the machine or the project. */
  export let context: "machine" | "project" = "machine";
  /** Touch layout: a visible actions button instead of hover actions. */
  export let touch = false;

  const dispatch = createEventDispatcher<{
    select: { split: boolean };
    rename: string;
    bell: boolean;
    pin: boolean;
    menu: { x: number; y: number };
    dragstart: DragEvent;
    drop: { event: DragEvent; after: boolean };
  }>();

  let editing = false;
  let draft = "";
  let input: HTMLInputElement;
  let dropHint: "before" | "after" | null = null;

  $: unread = needsAttention(item, $lastSeen) && item.state === "done";
  $: urgent = item.state === "question" || item.state === "permission";
  $: subtitle = [context === "machine" ? item.machine.name : item.project, item.meta?.git?.branch].filter(Boolean).join(" · ");
  $: detail = item.online && (urgent || item.state === "done") ? item.meta?.agent?.message : null;
  $: when = item.online && item.state !== "none" && item.state !== "idle" ? ago(item.since, $now) : "";

  export async function startRename() {
    draft = item.customName ?? item.name;
    editing = true;
    await tick();
    input?.select();
  }

  function commit() {
    if (!editing) return;
    editing = false;
    if (draft.trim() !== (item.customName ?? item.name)) dispatch("rename", draft);
  }

  function onDragOver(event: DragEvent) {
    event.preventDefault();
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    dropHint = event.clientY > rect.top + rect.height / 2 ? "after" : "before";
  }

  function openMenu(event: MouseEvent) {
    const target = event.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    dispatch("menu", { x: rect.right, y: rect.bottom + 4 });
  }
</script>

<!-- svelte-ignore a11y-no-static-element-interactions -->
<div
  class="group relative flex cursor-pointer select-none items-start gap-2.5 rounded-lg px-2.5 transition-colors"
  class:py-2={!touch}
  class:py-3={touch}
  class:bg-zinc-800={selected}
  class:hover:bg-zinc-900={!selected}
  class:opacity-50={!item.online}
  draggable={!editing}
  data-testid="terminal-row"
  data-key={item.key}
  data-state={item.state}
  data-online={item.online}
  data-unread={unread}
  on:click={(e) => dispatch("select", { split: e.altKey || e.metaKey })}
  on:keydown={(e) => e.key === "Enter" && dispatch("select", { split: false })}
  on:dblclick|stopPropagation={startRename}
  on:contextmenu|preventDefault={(e) => dispatch("menu", { x: e.clientX, y: e.clientY })}
  on:dragstart={(e) => dispatch("dragstart", e)}
  on:dragover={onDragOver}
  on:dragleave={() => (dropHint = null)}
  on:drop|preventDefault={(e) => {
    const after = dropHint === "after";
    dropHint = null;
    dispatch("drop", { event: e, after });
  }}
  role="button"
  tabindex="0"
>
  {#if selected}<div class="absolute inset-y-2 left-0 w-[3px] rounded-full bg-indigo-400" />{/if}
  {#if dropHint}
    <div class="pointer-events-none absolute inset-x-1 h-0.5 rounded bg-indigo-400 {dropHint === 'before' ? 'top-0' : 'bottom-0'}" />
  {/if}
  <div class="pt-px"><StatusBadge state={item.state} online={item.online} {unread} /></div>
  <div class="min-w-0 flex-1">
    <div class="flex items-center gap-1.5">
      {#if editing}
        <!-- svelte-ignore a11y-autofocus -->
        <input
          bind:this={input}
          bind:value={draft}
          class="w-full rounded-md border border-indigo-400 bg-zinc-950 px-1.5 py-px text-[15px] text-zinc-100 outline-none"
          aria-label="Nom du terminal"
          on:blur={commit}
          on:keydown|stopPropagation={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") editing = false;
          }}
          on:click|stopPropagation
          autofocus
        />
      {:else}
        <span
          class="min-w-0 truncate text-[15px] leading-6"
          class:text-zinc-50={selected || urgent || unread}
          class:text-zinc-200={!selected && !urgent && !unread}
          class:font-semibold={urgent || unread}
          class:font-medium={!urgent && !unread}
          title={item.name}
          data-testid="terminal-name"
        >
          {item.name}
        </span>
        {#if item.pinned}<Icon name="pin" size={12} class="text-zinc-500" />{/if}
        {#if item.bell}<Icon name="bell" size={12} class="text-amber-300" />{/if}
        <span class="flex-1" />
        {#if when}<span class="shrink-0 text-xs tabular-nums text-zinc-500 group-hover:invisible">{when}</span>{/if}
      {/if}
    </div>
    {#if subtitle}<div class="truncate font-mono text-xs leading-5 text-zinc-500">{subtitle}</div>{/if}
    {#if detail}
      <div
        class="mt-0.5 line-clamp-2 text-[13px] leading-snug"
        class:text-amber-200={urgent}
        class:text-zinc-400={!urgent}
        data-testid="terminal-detail"
      >
        {detail}
      </div>
    {/if}
  </div>
  {#if touch && !editing}
    <button
      class="-mr-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-zinc-400 active:bg-zinc-800"
      aria-label="Actions"
      on:click|stopPropagation={openMenu}
    >
      <Icon name="more" size={18} stroke={2.6} />
    </button>
  {:else if !editing}
    <div class="absolute right-1.5 top-1.5 hidden items-center rounded-md bg-zinc-800 shadow group-hover:flex">
      <button
        class="flex h-7 w-7 items-center justify-center rounded-md hover:bg-zinc-700"
        class:text-amber-300={item.bell}
        class:text-zinc-400={!item.bell}
        title={item.bell ? "Couper les notifications" : "Me notifier pour ce terminal"}
        aria-label={item.bell ? "Couper les notifications" : "Me notifier"}
        on:click|stopPropagation={() => dispatch("bell", !item.bell)}
      >
        <Icon name="bell" size={15} filled={item.bell} />
      </button>
      <button
        class="flex h-7 w-7 items-center justify-center rounded-md hover:bg-zinc-700"
        class:text-zinc-100={item.pinned}
        class:text-zinc-400={!item.pinned}
        title={item.pinned ? "Désépingler" : "Épingler en haut"}
        aria-label={item.pinned ? "Désépingler" : "Épingler"}
        on:click|stopPropagation={() => dispatch("pin", !item.pinned)}
      >
        <Icon name="pin" size={15} filled={item.pinned} />
      </button>
      <button
        class="flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-700 hover:text-zinc-100"
        title="Plus d'actions"
        aria-label="Plus d'actions"
        on:click|stopPropagation={openMenu}
      >
        <Icon name="more" size={16} stroke={2.6} />
      </button>
    </div>
  {/if}
</div>
