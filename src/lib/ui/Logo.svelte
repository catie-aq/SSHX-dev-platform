<!-- @component sshx mark and name. -->
<script lang="ts">
  export let size = 28;
  export let label = true;
</script>

<span class="inline-flex items-center gap-2">
  <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden="true">
    <rect x="1" y="1" width="30" height="30" rx="8" fill="#27272a" stroke="#3f3f46" />
    <path d="M9 11l6 5-6 5" stroke="#818cf8" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round" />
    <path d="M17 22h7" stroke="#d4d4d8" stroke-width="2.6" stroke-linecap="round" />
  </svg>
  {#if label}<span class="text-[17px] font-semibold tracking-tight text-zinc-100">sshx</span>{/if}
</span>
