<!-- @component Agent state of a terminal, as a compact badge. -->
<script lang="ts">
  import type { AgentState } from "$lib/api";

  export let state: AgentState;
  export let online = true;
  /** A finished turn not looked at yet. */
  export let unread = false;
  export let size: "sm" | "md" = "sm";

  const TITLES: Record<AgentState, string> = {
    none: "Terminal",
    idle: "Agent en attente",
    working: "Travail en cours",
    question: "Question pour vous",
    permission: "Autorisation demandée",
    done: "Travail terminé",
  };

  $: box = size === "md" ? "h-5 w-5 text-[11px]" : "h-4 w-4 text-[10px]";
  $: title = online ? TITLES[state] + (state === "done" && unread ? " (non lu)" : "") : "Hors ligne";
</script>

<span class="inline-flex shrink-0 items-center justify-center {box}" {title} aria-label={title}>
  {#if !online}
    <span class="h-2 w-2 rounded-full border border-zinc-600" />
  {:else if state === "working"}
    <span class="relative flex h-2.5 w-2.5">
      <span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-indigo-400 opacity-40" />
      <span class="relative inline-flex h-2.5 w-2.5 rounded-full bg-indigo-400" />
    </span>
  {:else if state === "question"}
    <span class="flex {box} items-center justify-center rounded-full bg-amber-400 font-bold text-zinc-900">?</span>
  {:else if state === "permission"}
    <span class="flex {box} items-center justify-center rounded-full bg-orange-500 font-bold text-zinc-900">!</span>
  {:else if state === "done"}
    {#if unread}
      <span class="flex {box} items-center justify-center rounded-full bg-emerald-400 font-bold text-zinc-900">✓</span>
    {:else}
      <span class="font-bold text-emerald-500/70">✓</span>
    {/if}
  {:else if state === "idle"}
    <span class="h-2.5 w-2.5 rounded-full border-2 border-indigo-400/70" />
  {:else}
    <span class="font-mono font-semibold text-zinc-500">›</span>
  {/if}
</span>
