<!-- @component Agent state of a terminal, as a compact badge. -->
<script lang="ts" context="module">
  import type { AgentState } from "$lib/api";

  export const STATE_LABELS: Record<AgentState, string> = {
    none: "Terminal",
    idle: "Agent en attente",
    working: "Travail en cours",
    question: "Question pour vous",
    permission: "Autorisation demandée",
    done: "Travail terminé",
  };
</script>

<script lang="ts">
  export let state: AgentState;
  export let online = true;
  /** A finished turn not looked at yet. */
  export let unread = false;
  export let size: "sm" | "md" = "sm";

  $: box = size === "md" ? "h-[22px] w-[22px] text-xs" : "h-[18px] w-[18px] text-[11px]";
  $: dot = size === "md" ? "h-3 w-3" : "h-2.5 w-2.5";
  $: title = online ? STATE_LABELS[state] + (state === "done" && unread ? " (non lu)" : "") : "Hors ligne";
</script>

<span class="inline-flex shrink-0 items-center justify-center {box}" {title} aria-label={title} data-state={state}>
  {#if !online}
    <span class="{dot} rounded-full border-2 border-zinc-600" />
  {:else if state === "working"}
    <span class="relative flex {dot}">
      <span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-indigo-400 opacity-50" />
      <span class="relative inline-flex {dot} rounded-full bg-indigo-400" />
    </span>
  {:else if state === "question"}
    <span class="flex {box} items-center justify-center rounded-full bg-amber-400 font-bold text-zinc-950">?</span>
  {:else if state === "permission"}
    <span class="flex {box} items-center justify-center rounded-full bg-orange-500 font-bold text-zinc-950">!</span>
  {:else if state === "done"}
    {#if unread}
      <span class="flex {box} items-center justify-center rounded-full bg-emerald-400 font-bold text-zinc-950">✓</span>
    {:else}
      <span class="font-bold text-emerald-500/80">✓</span>
    {/if}
  {:else if state === "idle"}
    <span class="{dot} rounded-full border-2 border-indigo-400/80" />
  {:else}
    <span class="{dot} rounded-full bg-zinc-600" />
  {/if}
</span>
