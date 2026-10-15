<!-- @component Extra keys for touch keyboards. -->
<script lang="ts">
  import { createEventDispatcher } from "svelte";

  export let ctrlArmed = false;

  const dispatch = createEventDispatcher<{ key: string }>();

  const KEYS: [string, string][] = [
    ["Esc", "\x1b"],
    ["Tab", "\t"],
    ["↑", "\x1b[A"],
    ["↓", "\x1b[B"],
    ["←", "\x1b[D"],
    ["→", "\x1b[C"],
    ["^C", "\x03"],
    ["^D", "\x04"],
    ["|", "|"],
    ["/", "/"],
    ["~", "~"],
    ["-", "-"],
  ];
</script>

<div class="flex shrink-0 gap-1 overflow-x-auto border-t border-zinc-800 bg-zinc-900 px-1.5 py-1.5">
  <button
    class="min-w-[2.6rem] rounded-md border px-2 py-1.5 font-mono text-xs"
    class:border-indigo-400={ctrlArmed}
    class:text-indigo-300={ctrlArmed}
    class:border-zinc-700={!ctrlArmed}
    class:text-zinc-300={!ctrlArmed}
    on:pointerdown|preventDefault={() => (ctrlArmed = !ctrlArmed)}
  >
    Ctrl
  </button>
  {#each KEYS as [label, seq]}
    <button
      class="min-w-[2.4rem] rounded-md border border-zinc-700 px-2 py-1.5 font-mono text-xs text-zinc-300 active:bg-zinc-700"
      on:pointerdown|preventDefault={() => dispatch("key", seq)}
    >
      {label}
    </button>
  {/each}
</div>
