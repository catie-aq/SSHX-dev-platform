<!-- @component Centered dialog over a dimmed backdrop. -->
<script lang="ts">
  import { createEventDispatcher } from "svelte";

  import Icon from "./Icon.svelte";

  export let title: string;
  export let width = 520;

  const dispatch = createEventDispatcher<{ close: void }>();
</script>

<svelte:window on:keydown={(e) => e.key === "Escape" && dispatch("close")} />

<div class="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/60 p-4 pt-[10vh] backdrop-blur-[2px]">
  <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
  <div class="absolute inset-0" on:click={() => dispatch("close")} />
  <div class="panel relative w-full p-6 shadow-2xl shadow-black/60" style:max-width="{width}px" role="dialog" aria-modal="true" aria-label={title}>
    <div class="mb-5 flex items-center gap-3">
      <h2 class="flex-1 text-lg font-semibold text-zinc-50">{title}</h2>
      <button class="icon-btn -mr-2" aria-label="Fermer" on:click={() => dispatch("close")}><Icon name="x" size={18} /></button>
    </div>
    <slot />
  </div>
</div>
