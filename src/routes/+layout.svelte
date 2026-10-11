<script lang="ts">
	import "../app.css";
	let { children } = $props();
</script>

<main class="mx-auto max-w-3xl px-4 py-8">
	<header class="mb-6 flex items-center justify-between">
		<a href="/" class="text-lg font-semibold tracking-tight">Intelligent&nbsp;Todo</a>
		<span class="text-xs text-slate-400">state · events · jobs</span>
	</header>
	{@render children()}
</main>
