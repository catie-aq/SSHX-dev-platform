<!-- @component Small floating menu, closed by outside clicks and Escape. -->
<script lang="ts" context="module">
  export type MenuItem = { label: string; run: () => void; danger?: boolean; hint?: string } | "separator";
</script>

<script lang="ts">
  import { createEventDispatcher, onMount } from "svelte";

  export let x: number;
  export let y: number;
  export let items: MenuItem[];

  const dispatch = createEventDispatcher<{ close: void }>();
  let el: HTMLDivElement;
  let left = x;
  let top = y;

  onMount(() => {
    const rect = el.getBoundingClientRect();
    left = Math.max(8, Math.min(x, window.innerWidth - rect.width - 8));
    top = Math.max(8, Math.min(y, window.innerHeight - rect.height - 8));
  });

  function activate(item: MenuItem) {
    dispatch("close");
    if (item !== "separator") item.run();
  }

  function onWindow(event: Event) {
    if (event instanceof KeyboardEvent ? event.key === "Escape" : !el?.contains(event.target as Node)) {
      dispatch("close");
    }
  }
</script>

<svelte:window on:pointerdown|capture={onWindow} on:keydown={onWindow} on:blur={() => dispatch("close")} />

<div
  bind:this={el}
  class="fixed z-50 min-w-[200px] rounded-lg border border-zinc-700 bg-zinc-800 py-1 text-sm shadow-xl"
  style:left="{left}px"
  style:top="{top}px"
  role="menu"
>
  {#each items as item}
    {#if item === "separator"}
      <div class="my-1 border-t border-zinc-700" />
    {:else}
      <button
        class="flex w-full items-center justify-between gap-4 px-3 py-1.5 text-left hover:bg-zinc-700"
        class:text-red-300={item.danger}
        class:text-zinc-200={!item.danger}
        role="menuitem"
        on:click={() => activate(item)}
      >
        <span>{item.label}</span>
        {#if item.hint}<span class="text-xs text-zinc-500">{item.hint}</span>{/if}
      </button>
    {/if}
  {/each}
</div>
