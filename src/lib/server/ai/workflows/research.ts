import { eq } from "drizzle-orm";
import { aiResults, tasks } from "../../db/schema";
import { newId, nowIso, type DB } from "../../db/db";
import { appendEvent } from "../../events/store";
import { markJobCompleted, type JobRow } from "../../jobs/queue";
import { getProvider } from "../llm";
import { RESEARCH_SYSTEM } from "../prompts/research";
import { ResearchOutput } from "../schemas";

// Explicit context builder: only what this workflow needs, never the whole DB.
function buildResearchContext(task: typeof tasks.$inferSelect): string {
	const parts = [`Task title: ${task.title}`];
	if (task.description) parts.push(`Task description: ${task.description}`);
	const classification = [task.category, task.taskType, task.intent].filter(Boolean).join(" · ");
	if (classification) parts.push(`Classification: ${classification}`);
	parts.push("Research this task as instructed in the system prompt.");
	return parts.join("\n\n");
}

export async function runResearch(db: DB, job: JobRow): Promise<void> {
	const provider = getProvider();
	if (!provider) {
		throw new Error(
			"No LLM provider configured — set OPENAI_API_KEY (optionally OPENAI_BASE_URL, OPENAI_MODEL)"
		);
	}
	const task = job.taskId
		? db.select().from(tasks).where(eq(tasks.id, job.taskId)).get()
		: null;
	if (!task) throw new Error(`Task not found for job ${job.id}`);

	const result = await provider.complete({
		system: RESEARCH_SYSTEM,
		user: buildResearchContext(task)
	});
	// Never trust LLM output blindly: parse + validate before persistence.
	const output = ResearchOutput.parse(result.data);

	db.transaction((tx) => {
		const now = nowIso();
		tx.insert(aiResults)
			.values({
				id: newId(),
				taskId: task.id,
				jobId: job.id,
				type: "research",
				content: output.summary,
				structuredData: output as unknown as Record<string, unknown>,
				model: result.model,
				provider: result.provider,
				inputTokens: result.inputTokens,
				outputTokens: result.outputTokens,
				latencyMs: result.latencyMs,
				createdAt: now
			})
			.run();
		markJobCompleted(tx, job.id, task.id, output);
		appendEvent(tx, {
			type: "TaskEnriched",
			aggregateType: "task",
			aggregateId: task.id,
			payload: { jobId: job.id, resultType: "research" }
		});
		tx.update(tasks)
			.set({ aiStatus: "completed", updatedAt: now })
			.where(eq(tasks.id, task.id))
			.run();
	});
}
