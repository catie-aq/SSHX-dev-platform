<!-- @component A shell command with a copy button. -->
<script lang="ts">
  import Icon from "./Icon.svelte";

  export let command: string;
  export let testid: string | undefined = undefined;
  export let large = false;

  let copied = false;
  let timer: ReturnType<typeof setTimeout>;

  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
    } catch {
      // Clipboard API unavailable (plain HTTP): select the text instead.
      const range = document.createRange();
      range.selectNodeContents(code);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
      return;
    }
    copied = true;
    clearTimeout(timer);
    timer = setTimeout(() => (copied = false), 2000);
  }

  let code: HTMLElement;
</script>

<div class="flex items-stretch overflow-hidden rounded-lg border border-zinc-700 bg-zinc-950">
  <code
    bind:this={code}
    data-testid={testid}
    class="min-w-0 flex-1 select-all whitespace-pre-wrap break-all px-3 font-mono text-zinc-100"
    class:py-3={large}
    class:text-[13px]={large}
    class:py-2={!large}
    class:text-xs={!large}
  >{command}</code>
  <button
    type="button"
    class="flex shrink-0 items-center gap-1.5 border-l border-zinc-700 px-3 text-sm font-medium transition-colors hover:bg-zinc-800"
    class:text-emerald-400={copied}
    class:text-zinc-200={!copied}
    on:click={copy}
  >
    <Icon name={copied ? "check" : "copy"} size={15} />
    {copied ? "Copié" : "Copier"}
  </button>
</div>
