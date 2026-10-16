<!--
  @component Keyboard shortcuts reference. With `editable`, each one can be
  redefined: click "Modifier", then press the new combination.
-->
<script lang="ts">
  import { onDestroy } from "svelte";

  import {
    ACTIONS,
    bindings,
    comboFromEvent,
    isMac,
    overrides,
    recording,
    sameCombo,
    shortcutLabels,
    type ShortcutAction,
  } from "$lib/shortcuts";

  export let compact = false;
  export let editable = false;

  let error: string | null = null;

  function start(action: ShortcutAction) {
    error = null;
    recording.set(action);
  }

  function onKeydown(event: KeyboardEvent) {
    const action = $recording;
    if (!action) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Escape" && !event.ctrlKey && !event.altKey && !event.metaKey) {
      recording.set(null);
      error = null;
      return;
    }
    const combo = comboFromEvent(event, action);
    if (!combo) return;
    if ("error" in combo) {
      error = combo.error;
      return;
    }
    const taken = ACTIONS.find((a) => a.action !== action && sameCombo($bindings[a.action], combo));
    if (taken) {
      error = `Déjà utilisé pour « ${taken.label} ».`;
      return;
    }
    overrides.update((o) => ({ ...o, [action]: combo }));
    recording.set(null);
    error = null;
  }

  function reset() {
    overrides.set({});
    recording.set(null);
    error = null;
  }

  onDestroy(() => recording.set(null));

  $: customized = Object.keys($overrides).length > 0;
</script>

<svelte:window on:keydown|capture={onKeydown} />

<div data-testid="shortcuts-help">
  <dl
    class="grid items-center gap-x-5 text-zinc-400"
    class:grid-cols-[auto_1fr]={!editable}
    class:grid-cols-[auto_1fr_auto]={editable}
    class:gap-y-2.5={!compact}
    class:gap-y-2={compact}
    class:text-sm={compact}
    class:text-[15px]={!compact}
  >
    {#each ACTIONS as { action, label }}
      <dt class="justify-self-end whitespace-nowrap">
        {#if $recording === action}
          <span class="kbd animate-pulse border-indigo-400 text-indigo-200">…</span>
        {:else}
          <span class="kbd" data-testid="shortcut-{action}">{$shortcutLabels[action]}</span>
        {/if}
      </dt>
      <dd>{label}</dd>
      {#if editable}
        <button class="btn-ghost py-1 text-[13px]" on:click={() => start(action)}>Modifier</button>
      {/if}
    {/each}
    <dt class="justify-self-end"><span class="kbd">?</span></dt>
    <dd>Afficher les raccourcis (hors terminal)</dd>
    {#if editable}<span />{/if}
  </dl>

  {#if editable}
    {#if $recording}
      <p class="mt-4 rounded-lg border border-indigo-500/50 bg-indigo-500/10 px-3 py-2 text-sm text-indigo-100">
        Appuyez sur la nouvelle combinaison pour « {ACTIONS.find((a) => a.action === $recording)?.label} », ou Échap pour
        annuler.
      </p>
    {/if}
    {#if error}<p class="mt-2 text-sm text-red-400" data-testid="shortcut-error">{error}</p>{/if}
    <p class="mt-5 text-sm leading-relaxed text-zinc-500">
      Les lettres suivent votre disposition de clavier (BÉPO, AZERTY…). Ces touches ne sont jamais envoyées au shell.
      {#if isMac}⌥ seul est laissé à la saisie des caractères spéciaux ; ⌘K ouvre aussi la recherche.{/if}
      Réglages propres à cet appareil.
    </p>
    {#if customized}
      <button class="btn-ghost -ml-2.5 mt-2 text-sm" on:click={reset}>Rétablir les raccourcis par défaut</button>
    {/if}
  {/if}
</div>
