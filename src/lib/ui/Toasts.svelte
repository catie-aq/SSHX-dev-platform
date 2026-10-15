<script lang="ts">
  import { toasts } from "$lib/toast";
</script>

<div class="pointer-events-none fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-2">
  {#each $toasts as t (t.id)}
    <div
      class="pointer-events-auto rounded-lg border px-3 py-2 text-sm shadow-lg transition-opacity duration-200"
      class:border-zinc-700={t.kind === "info"}
      class:bg-zinc-800={t.kind !== "error"}
      class:text-zinc-200={t.kind !== "error"}
      class:border-red-900={t.kind === "error"}
      class:bg-red-950={t.kind === "error"}
      class:text-red-200={t.kind === "error"}
      class:border-emerald-800={t.kind === "success"}
    >
      {t.message}
    </div>
  {/each}
</div>
