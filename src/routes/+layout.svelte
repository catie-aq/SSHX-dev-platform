<script lang="ts">
  import "../app.css";
  import "sshx-xterm/css/xterm.css";
  import "@fontsource-variable/inter";

  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { page } from "$app/stores";

  import { api, ApiError } from "$lib/api";
  import { config, me } from "$lib/auth";
  import Toasts from "$lib/ui/Toasts.svelte";
  import { initVault } from "$lib/vault";

  let ready = false;
  let fatal: string | null = null;

  onMount(async () => {
    try {
      config.set(await api.config());
      try {
        const current = await api.me();
        me.set(current);
        await initVault(current);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          me.set(null);
          if ($page.url.pathname !== "/login") await goto("/login");
        } else {
          throw err;
        }
      }
    } catch (err) {
      fatal = err instanceof Error ? err.message : String(err);
    }
    ready = true;
  });
</script>

{#if fatal}
  <div class="flex h-dvh items-center justify-center p-6 text-center">
    <div>
      <p class="text-red-400">Plateforme injoignable</p>
      <p class="mt-1 text-sm text-zinc-500">{fatal}</p>
    </div>
  </div>
{:else if ready}
  <slot />
{:else}
  <div class="flex h-dvh items-center justify-center text-sm text-zinc-500">Chargement…</div>
{/if}

<Toasts />
