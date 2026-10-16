<!-- @component Keyboard shortcuts reference. -->
<script lang="ts">
  import { SHORTCUT_HELP } from "$lib/shortcuts";

  export let compact = false;
</script>

<dl class="grid grid-cols-[auto_1fr] items-center gap-x-5 text-zinc-400" class:gap-y-2.5={!compact} class:gap-y-2={compact} class:text-sm={compact} class:text-[15px]={!compact} data-testid="shortcuts-help">
  {#each SHORTCUT_HELP as s}
    <dt class="flex items-center gap-1 justify-self-end whitespace-nowrap">
      {#each s.keys as k}
        {#if k === "…"}<span class="text-zinc-600">…</span>{:else}<span class="kbd text-xs">{k}</span>{/if}
      {/each}
    </dt>
    <dd>{s.label}</dd>
  {/each}
</dl>
