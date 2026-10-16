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

<div class="flex shrink-0 gap-1.5 overflow-x-auto border-t border-zinc-800 bg-zinc-950 px-2 py-2" data-testid="mobile-keys">
  <button
    class="min-w-[3rem] rounded-lg border px-2.5 py-2 font-mono text-sm"
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
      class="min-w-[2.75rem] rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-2 font-mono text-sm text-zinc-200 active:bg-zinc-700"
      on:pointerdown|preventDefault={() => dispatch("key", seq)}
    >
      {label}
    </button>
  {/each}
</div>
