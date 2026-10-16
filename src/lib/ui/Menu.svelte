<!-- @component Floating menu, closed by outside clicks and Escape. -->
<script lang="ts" context="module">
  import type { IconName } from "./Icon.svelte";

  export type MenuItem =
    | { label: string; run: () => void; danger?: boolean; hint?: string; icon?: IconName; disabled?: boolean; title?: string }
    | { heading: string }
    | "separator";
</script>

<script lang="ts">
  import { createEventDispatcher, onMount } from "svelte";

  import Icon from "./Icon.svelte";

  export let x: number;
  export let y: number;
  export let items: MenuItem[];
  /** Align the right edge on `x` instead of the left edge. */
  export let alignRight = false;
  /** Open upwards: `y` is the bottom edge. */
  export let above = false;

  const dispatch = createEventDispatcher<{ close: void }>();
  let el: HTMLDivElement;
  let left = x;
  let top = y;

  onMount(() => {
    const rect = el.getBoundingClientRect();
    const wanted = alignRight ? x - rect.width : x;
    left = Math.max(8, Math.min(wanted, window.innerWidth - rect.width - 8));
    top = Math.max(8, Math.min(above ? y - rect.height : y, window.innerHeight - rect.height - 8));
    el.querySelector<HTMLButtonElement>("button:not([disabled])")?.focus({ preventScroll: true });
  });

  function activate(item: MenuItem) {
    if (item === "separator" || "heading" in item || item.disabled) return;
    dispatch("close");
    item.run();
  }

  function onWindow(event: Event) {
    if (event instanceof KeyboardEvent) {
      if (event.key === "Escape") dispatch("close");
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        const buttons = [...el.querySelectorAll<HTMLButtonElement>("button:not([disabled])")];
        const idx = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === "ArrowDown" ? idx + 1 : idx - 1;
        buttons[(next + buttons.length) % buttons.length]?.focus();
        event.preventDefault();
      }
    } else if (!el?.contains(event.target as Node)) {
      dispatch("close");
    }
  }
</script>

<svelte:window on:pointerdown|capture={onWindow} on:keydown={onWindow} on:blur={() => dispatch("close")} />

<div
  bind:this={el}
  class="fixed z-50 min-w-[230px] max-w-[320px] rounded-xl border border-zinc-700 bg-zinc-900 p-1 text-sm shadow-2xl shadow-black/50"
  style:left="{left}px"
  style:top="{top}px"
  role="menu"
>
  {#each items as item}
    {#if item === "separator"}
      <div class="mx-2 my-1 border-t border-zinc-800" />
    {:else if "heading" in item}
      <div class="px-2.5 pb-1 pt-2 text-xs font-medium text-zinc-500">{item.heading}</div>
    {:else}
      <button
        class="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left outline-none transition-colors enabled:hover:bg-zinc-800 enabled:focus:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
        class:text-red-300={item.danger}
        class:text-zinc-200={!item.danger}
        role="menuitem"
        disabled={item.disabled}
        title={item.title}
        on:click={() => activate(item)}
      >
        {#if item.icon}<Icon name={item.icon} size={16} class={item.danger ? "text-red-400" : "text-zinc-400"} />{/if}
        <span class="min-w-0 flex-1 truncate">{item.label}</span>
        {#if item.hint}<span class="shrink-0 text-xs text-zinc-500">{item.hint}</span>{/if}
      </button>
    {/if}
  {/each}
</div>
