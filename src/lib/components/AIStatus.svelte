<script lang="ts">
	let { status }: { status: string } = $props();
</script>

{#if status === "processing"}
	<span class="animate-pulse text-xs font-medium text-blue-600">● Understanding…</span>
{:else if status === "failed"}
	<span class="text-xs font-medium text-red-600" title="AI job failed — see task detail">⚠ AI failed</span>
{:else if status === "completed"}
	<span class="text-xs font-medium text-emerald-600" title="AI result available">✓ AI</span>
{/if}
