<!-- @component One terminal in the sidebar. -->
<script lang="ts">
  import { createEventDispatcher, tick } from "svelte";

  import { lastSeen, needsAttention } from "$lib/notify";
  import type { TermItem } from "$lib/workspace";
  import StatusBadge from "./StatusBadge.svelte";

  export let item: TermItem;
  export let selected = false;
  /** What to show under the name: the machine or the project. */
  export let context: "machine" | "project" = "machine";

  const dispatch = createEventDispatcher<{
    select: { split: boolean };
    rename: string;
    bell: boolean;
    pin: boolean;
    menu: MouseEvent;
    dragstart: DragEvent;
    drop: { event: DragEvent; after: boolean };
  }>();

  let editing = false;
  let draft = "";
  let input: HTMLInputElement;
  let dropHint: "before" | "after" | null = null;

  $: unread = needsAttention(item, $lastSeen) && item.state === "done";
  $: urgent = item.state === "question" || item.state === "permission";
  $: subtitle = [
    context === "machine" ? item.machine.name : item.project,
    item.meta?.git?.branch,
  ]
    .filter(Boolean)
    .join(" · ");
  $: detail = item.online && (urgent || item.state === "done") ? item.meta?.agent?.message : null;

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
</script>

<!-- svelte-ignore a11y-no-static-element-interactions -->
<div
  class="group relative flex cursor-pointer select-none items-start gap-2 rounded-md px-2 py-1.5 transition-colors"
  class:bg-zinc-800={selected}
  class:hover:bg-zinc-800={!selected}
  class:opacity-50={!item.online}
  draggable={!editing}
  on:click={(e) => dispatch("select", { split: e.altKey || e.metaKey })}
  on:keydown={(e) => e.key === "Enter" && dispatch("select", { split: false })}
  on:dblclick|stopPropagation={startRename}
  on:contextmenu|preventDefault={(e) => dispatch("menu", e)}
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
  {#if dropHint}
    <div class="pointer-events-none absolute inset-x-1 h-0.5 rounded bg-indigo-400 {dropHint === 'before' ? 'top-0' : 'bottom-0'}" />
  {/if}
  <div class="pt-0.5"><StatusBadge state={item.state} online={item.online} {unread} /></div>
  <div class="min-w-0 flex-1">
    {#if editing}
      <!-- svelte-ignore a11y-autofocus -->
      <input
        bind:this={input}
        bind:value={draft}
        class="w-full rounded border border-indigo-500 bg-zinc-900 px-1 text-sm text-zinc-100 outline-none"
        on:blur={commit}
        on:keydown|stopPropagation={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") editing = false;
        }}
        on:click|stopPropagation
        autofocus
      />
    {:else}
      <div
        class="truncate text-sm"
        class:text-zinc-100={selected || urgent || unread}
        class:text-zinc-300={!selected && !urgent && !unread}
        class:font-medium={urgent || unread}
        title={item.name}
      >
        {item.name}
      </div>
    {/if}
    <div class="truncate font-mono text-[11px] text-zinc-500">{subtitle || " "}</div>
    {#if detail}
      <div
        class="mt-0.5 line-clamp-2 text-[11px] leading-snug"
        class:text-amber-300={urgent}
        class:text-zinc-400={!urgent}
      >
        {detail}
      </div>
    {/if}
  </div>
  <div class="flex shrink-0 items-center gap-0.5 pt-0.5">
    <button
      class="rounded px-0.5 text-xs transition-opacity hover:text-zinc-100"
      class:opacity-0={!item.pinned}
      class:group-hover:opacity-100={!item.pinned}
      class:text-zinc-300={item.pinned}
      class:text-zinc-500={!item.pinned}
      title={item.pinned ? "Désépingler" : "Épingler"}
      on:click|stopPropagation={() => dispatch("pin", !item.pinned)}
    >
      {item.pinned ? "◆" : "◇"}
    </button>
    <button
      class="rounded px-0.5 text-xs transition-opacity hover:text-zinc-100"
      class:opacity-0={!item.bell}
      class:group-hover:opacity-100={!item.bell}
      class:text-amber-300={item.bell}
      class:text-zinc-500={!item.bell}
      title={item.bell ? "Notifications activées" : "Me notifier pour ce terminal"}
      on:click|stopPropagation={() => dispatch("bell", !item.bell)}
    >
      <svg viewBox="0 0 16 16" class="h-3.5 w-3.5" fill={item.bell ? "currentColor" : "none"} stroke="currentColor" stroke-width="1.4">
        <path d="M8 2.2c-2.3 0-3.8 1.7-3.8 4v2.6L3 10.6h10l-1.2-1.8V6.2c0-2.3-1.5-4-3.8-4zM6.6 12.4a1.5 1.5 0 0 0 2.8 0" stroke-linejoin="round" />
      </svg>
    </button>
  </div>
</div>
