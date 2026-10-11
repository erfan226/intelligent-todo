<script lang="ts">
	import { invalidateAll } from "$app/navigation";
	import { enhance } from "$app/forms";
	import AIStatus from "$lib/components/AIStatus.svelte";

	let { data } = $props();
	let title = $state("");
	let adding = $state(false);

	const anyProcessing = $derived(data.tasks.some((t: { aiStatus: string }) => t.aiStatus === "processing"));

	$effect(() => {
		if (!anyProcessing) return;
		const i = setInterval(() => void invalidateAll(), 2500);
		return () => clearInterval(i);
	});
</script>

<h1 class="mb-4 text-xl font-semibold">Tasks</h1>

<form
	method="POST"
	action="?/create"
	class="mb-6 flex gap-2"
	use:enhance={() => {
		adding = true;
		return async ({ update }) => {
			adding = false;
			title = "";
			await update();
		};
	}}
>
	<input
		name="title"
		bind:value={title}
		placeholder="e.g. Research whether we should move BBB recordings to cheaper storage"
		required
		maxlength="500"
		class="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-slate-500"
	/>
	<button
		disabled={adding}
		class="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
	>
		Add
	</button>
</form>

<ul class="space-y-2">
	{#each data.tasks as task (task.id)}
		<li class="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-3">
			<form method="POST" action="?/status">
				<input type="hidden" name="id" value={task.id} />
				<input type="hidden" name="status" value={task.status === "completed" ? "pending" : "completed"} />
				<button
					class="flex h-5 w-5 items-center justify-center rounded-full border border-slate-400 text-xs text-slate-700 hover:border-slate-700"
					title={task.status === "completed" ? "Reopen" : "Mark done"}
				>
					{task.status === "completed" ? "✓" : ""}
				</button>
			</form>

			<div class="min-w-0 flex-1">
				<a
					href="/tasks/{task.id}"
					class="block truncate text-sm font-medium hover:underline {task.status === 'completed'
						? 'text-slate-400 line-through'
						: ''}"
				>
					{task.title}
				</a>
				{#if task.category}
					<div class="text-xs text-slate-500">
						{task.category} · {task.taskType} · {task.intent}
					</div>
				{/if}
			</div>

			<AIStatus status={task.aiStatus} />
			<span class="w-20 text-right text-xs text-slate-400">{task.status}</span>
		</li>
	{:else}
		<li class="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
			No tasks yet — add one above.
		</li>
	{/each}
</ul>
