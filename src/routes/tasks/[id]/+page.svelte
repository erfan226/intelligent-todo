<script lang="ts">
	import { invalidateAll } from "$app/navigation";
	import { enhance } from "$app/forms";
	import AIStatus from "$lib/components/AIStatus.svelte";

	let { data } = $props();

	const task = $derived(data.task);
	const research = $derived(
		(data.results[0]?.structuredData ?? null) as
			| { summary?: string; findings?: { title: string; content: string }[]; recommendation?: string; next_actions?: string[] }
			| null
	);
	const lastError = $derived(
		data.events.find((e: { type: string }) => e.type === "AIJobFailed")?.payload?.error as string | undefined
	);

	$effect(() => {
		if (task.aiStatus !== "processing") return;
		const i = setInterval(() => void invalidateAll(), 2500);
		return () => clearInterval(i);
	});
</script>

<a href="/" class="mb-4 inline-block text-sm text-slate-500 hover:underline">← All tasks</a>

<article class="rounded-lg border border-slate-200 bg-white p-5">
	<div class="flex items-start justify-between gap-4">
		<h1 class="text-lg font-semibold {task.status === 'completed' ? 'text-slate-400 line-through' : ''}">
			{task.title}
		</h1>
		<AIStatus status={task.aiStatus} />
	</div>

	{#if task.description}
		<p class="mt-2 text-sm text-slate-600">{task.description}</p>
	{/if}

	{#if task.category}
		<div class="mt-3 flex flex-wrap gap-1.5">
			{#each [task.category, task.taskType, task.intent, task.complexity].filter(Boolean) as chip (chip)}
				<span class="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{chip}</span>
			{/each}
		</div>
	{/if}

	<div class="mt-4 flex gap-2">
		<form method="POST" action="?/status">
			<input type="hidden" name="id" value={task.id} />
			<input type="hidden" name="status" value={task.status === "completed" ? "pending" : "completed"} />
			<button class="rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:border-slate-500">
				{task.status === "completed" ? "Reopen" : "Mark done"}
			</button>
		</form>
		<form
			method="POST"
			action="?/research"
			use:enhance={() => async ({ update }) => update()}
		>
			<button
				disabled={task.aiStatus === "processing"}
				class="rounded-lg bg-slate-900 px-3 py-1.5 text-sm text-white hover:bg-slate-700 disabled:opacity-50"
			>
				Run AI research
			</button>
		</form>
	</div>
</article>

{#if task.aiStatus === "processing"}
	<p class="mt-4 text-sm text-blue-600">● AI is working on this task…</p>
{/if}

{#if lastError && task.aiStatus === "failed"}
	<p class="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
		AI job failed: {lastError}
	</p>
{/if}

{#if research}
	<section class="mt-4 rounded-lg border border-slate-200 bg-white p-5">
		<h2 class="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">AI research</h2>
		<h3 class="mb-1 text-sm font-semibold">Summary</h3>
		<p class="text-sm text-slate-700">{research.summary}</p>

		<h3 class="mb-1 mt-4 text-sm font-semibold">Findings</h3>
		<ul class="space-y-2">
			{#each research.findings ?? [] as f}
				<li class="text-sm">
					<span class="font-medium">{f.title}.</span>
					<span class="text-slate-700">{f.content}</span>
				</li>
			{/each}
		</ul>

		<h3 class="mb-1 mt-4 text-sm font-semibold">Recommendation</h3>
		<p class="text-sm text-slate-700">{research.recommendation}</p>

		{#if research.next_actions?.length}
			<h3 class="mb-1 mt-4 text-sm font-semibold">Suggested next actions</h3>
			<ul class="list-disc space-y-1 pl-5 text-sm text-slate-700">
				{#each research.next_actions as a}
					<li>{a}</li>
				{/each}
			</ul>
		{/if}

		<p class="mt-4 text-xs text-slate-400">
			{data.results[0].provider} · {data.results[0].model} · {data.results[0].latencyMs}ms
			{#if data.results[0].inputTokens}
				· {data.results[0].inputTokens}+{data.results[0].outputTokens} tokens
			{/if}
		</p>
	</section>
{/if}

<section class="mt-4 rounded-lg border border-slate-200 bg-white p-5">
	<h2 class="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Activity</h2>
	<ul class="space-y-1.5">
		{#each data.events as e (e.id)}
			<li class="flex items-baseline gap-2 text-sm">
				<span class="w-36 shrink-0 text-xs text-slate-400">{new Date(e.createdAt).toLocaleString()}</span>
				<span class="font-medium">{e.type}</span>
			</li>
		{:else}
			<li class="text-sm text-slate-500">No events.</li>
		{/each}
	</ul>
</section>
