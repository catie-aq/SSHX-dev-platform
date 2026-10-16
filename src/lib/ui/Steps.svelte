<!-- @component Progress of the first-run setup. -->
<script lang="ts">
  export let current: 1 | 2 | 3;

  const STEPS = ["Connexion", "Phrase secrète", "Première machine"];
</script>

<ol class="flex items-center gap-2 text-xs font-medium" aria-label="Étapes de mise en route">
  {#each STEPS as label, i}
    {@const n = i + 1}
    <li class="flex items-center gap-2" aria-current={n === current ? "step" : undefined}>
      <span
        class="flex h-5 w-5 items-center justify-center rounded-full text-[11px]"
        class:bg-emerald-500={n < current}
        class:text-zinc-950={n <= current}
        class:bg-indigo-400={n === current}
        class:bg-zinc-800={n > current}
        class:text-zinc-500={n > current}
      >
        {n < current ? "✓" : n}
      </span>
      <span class:text-zinc-100={n === current} class:text-zinc-500={n !== current}>{label}</span>
    </li>
    {#if n < STEPS.length}<li class="h-px w-5 bg-zinc-700" aria-hidden="true" />{/if}
  {/each}
</ol>
