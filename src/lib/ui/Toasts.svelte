<script lang="ts">
  import { toasts } from "$lib/toast";
  import Icon from "./Icon.svelte";
</script>

<div class="pointer-events-none fixed bottom-5 left-1/2 z-50 flex w-[min(92vw,480px)] -translate-x-1/2 flex-col items-center gap-2" aria-live="polite">
  {#each $toasts as t (t.id)}
    <div
      class="pointer-events-auto flex items-start gap-2.5 rounded-xl border px-4 py-2.5 text-[14px] shadow-xl shadow-black/40"
      class:border-zinc-700={t.kind === "info"}
      class:bg-zinc-900={t.kind !== "error"}
      class:text-zinc-100={t.kind !== "error"}
      class:border-red-900={t.kind === "error"}
      class:bg-red-950={t.kind === "error"}
      class:text-red-100={t.kind === "error"}
      class:border-emerald-800={t.kind === "success"}
      data-testid="toast"
      data-kind={t.kind}
    >
      {#if t.kind === "success"}<Icon name="check" size={16} class="mt-0.5 text-emerald-400" />{/if}
      <span>{t.message}</span>
    </div>
  {/each}
</div>
