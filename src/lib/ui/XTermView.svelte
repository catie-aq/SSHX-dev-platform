<!-- @component A full-pane xterm.js terminal bound to one sshx shell. -->
<script lang="ts" context="module">
  // Deduplicated terminal font loading (as in sshx's XTerm.svelte).
  let fontsReady: Promise<void> | null = null;
  function waitForFonts(): Promise<void> {
    if (!fontsReady) {
      fontsReady = import("fontfaceobserver")
        .then(({ default: FontFaceObserver }) => new FontFaceObserver("Fira Code VF").load())
        .then(() => undefined)
        .catch(() => undefined);
    }
    return fontsReady;
  }
</script>

<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import type { Terminal } from "sshx-xterm";

  import themes, { defaultTheme } from "$sshx/ui/themes";
  import { TypeAheadAddon } from "$sshx/typeahead";

  import type { SessionConnection } from "$lib/connection";

  export let conn: SessionConnection;
  export let sid: number;
  export let fontSize = 14;
  /** One-shot Ctrl modifier armed by the mobile key bar. */
  export let ctrlArmed = false;

  const isMac = typeof navigator !== "undefined" && navigator.platform.startsWith("Mac");
  const canWrite = conn.canWrite;

  let el: HTMLDivElement;
  let term: Terminal | null = null;
  let fit: { fit(): void; proposeDimensions(): { rows: number; cols: number } | undefined } | null = null;
  let stopListening: (() => void) | null = null;
  let observer: ResizeObserver | null = null;
  let resizeTimer: ReturnType<typeof setTimeout> | null = null;
  const typeahead = new TypeAheadAddon();
  const utf8 = new TextEncoder();

  export function focus() {
    term?.focus();
  }

  /** Send raw input, as typed. */
  export function send(data: string | Uint8Array) {
    if (!$canWrite) return;
    conn.input(sid, typeof data === "string" ? utf8.encode(data) : data);
  }

  function applyCtrl(data: string): string {
    if (!ctrlArmed || data.length !== 1) return data;
    ctrlArmed = false;
    const code = data.toUpperCase().charCodeAt(0);
    if (code >= 64 && code <= 95) return String.fromCharCode(code - 64);
    return data;
  }

  function refit() {
    if (!term || !fit || !el || el.clientWidth === 0 || el.clientHeight === 0) return;
    const dims = fit.proposeDimensions();
    if (!dims || !Number.isFinite(dims.rows) || !Number.isFinite(dims.cols)) return;
    const rows = Math.max(4, dims.rows);
    const cols = Math.max(20, dims.cols);
    if (term.rows !== rows || term.cols !== cols) term.resize(cols, rows);
    conn.resize(sid, rows, cols);
  }

  function scheduleFit() {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(refit, 60);
  }

  $: if (term) {
    term.options.fontSize = fontSize;
    scheduleFit();
  }

  onMount(async () => {
    const [{ Terminal }, { FitAddon }, { WebLinksAddon }] = await Promise.all([
      import("sshx-xterm"),
      import("xterm-addon-fit"),
      import("xterm-addon-web-links"),
    ]);
    await waitForFonts();
    if (!el) return;

    term = new Terminal({
      allowTransparency: false,
      cursorBlink: false,
      cursorStyle: "block",
      fontFamily:
        '"Fira Code VF", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
      fontSize,
      fontWeight: 400,
      fontWeightBold: 500,
      lineHeight: 1.06,
      scrollback: 10000,
      theme: themes[defaultTheme],
    });
    fit = new FitAddon() as any;
    term.loadAddon(fit as any);
    term.loadAddon(new WebLinksAddon() as any);
    term.attachCustomKeyEventHandler((event) => {
      const mod = isMac ? event.metaKey : event.ctrlKey;
      // Copy with a selection instead of sending SIGINT; let the browser paste.
      if (mod && event.key === "c" && term!.hasSelection()) return false;
      if (mod && event.key === "v") return false;
      if (isMac && event.metaKey) return false;
      return true;
    });
    term.open(el);
    try {
      const { WebglAddon } = await import("xterm-addon-webgl");
      term.loadAddon(new WebglAddon() as any);
    } catch {
      /* canvas renderer fallback */
    }
    typeahead.reset();
    term.loadAddon(typeahead as any);

    stopListening = conn.listen(
      sid,
      (text) => term?.write(typeahead.onBeforeProcessData(text)),
      (history) => {
        term?.reset();
        if (history) term?.write(history);
      },
    );
    term.onData((data) => send(applyCtrl(data)));
    term.onBinary((data) => send(Uint8Array.from(data, (c) => c.charCodeAt(0))));

    observer = new ResizeObserver(scheduleFit);
    observer.observe(el);
    refit();
    // Take the focus unless the user is typing in a field (e.g. a rename box).
    const a = document.activeElement;
    const typing =
      a instanceof HTMLInputElement ||
      a instanceof HTMLSelectElement ||
      (a instanceof HTMLTextAreaElement && !a.classList.contains("xterm-helper-textarea"));
    if (!typing) term.focus();
  });

  onDestroy(() => {
    stopListening?.();
    observer?.disconnect();
    if (resizeTimer) clearTimeout(resizeTimer);
    term?.dispose();
  });
</script>

<div class="h-full w-full overflow-hidden px-2 py-1" style:background={themes[defaultTheme].background}>
  <div bind:this={el} class="h-full w-full" />
</div>
