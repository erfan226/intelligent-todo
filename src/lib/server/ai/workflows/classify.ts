import { eq } from "drizzle-orm";
import { nowIso, type DB } from "../../db/db";
import { markJobCompleted, enqueueJob, type JobRow } from "../../jobs/queue";
import { tasks } from "../../db/schema";
import { appendEvent } from "../../events/store";
import { classifyTask, route } from "../jev";

// Level 1 classification: ask Clef, apply hard routing rules, persist.
// The application (not Clef) decides what gets persisted and what runs.
export async function runClassify(db: DB, job: JobRow): Promise<void> {
	const task = job.taskId
		? db.select().from(tasks).where(eq(tasks.id, job.taskId)).get()
		: null;
	if (!task) throw new Error(`Task not found for job ${job.id}`);

	const decision = await classifyTask({ title: task.title, description: task.description });
	const routed = route(decision, { title: task.title, description: task.description });
	const now = nowIso();
	db.transaction((tx) => {
		tx.update(tasks)
			.set({
				category: decision.category,
				taskType: decision.task_type,
				intent: decision.intent,
				complexity: decision.complexity,
				aiStatus: routed.requiresAI ? "processing" : "idle",
				latestAiJobId: job.id,
				updatedAt: now
			})
			.where(eq(tasks.id, task.id))
			.run();
		if (routed.requiresAI && routed.workflow) {
			enqueueJob(tx, {
				taskId: task.id,
				type: routed.workflow,
				idempotencyKey: `task:${task.id}:research:v1`,
				input: { workflow: decision.workflow, reason: routed.reason }
			});
		}
		appendEvent(tx, {
			type: "TaskClassified",
			aggregateType: "task",
			aggregateId: task.id,
			payload: { ...decision, routing: routed.reason }
		});
		markJobCompleted(tx, job.id, task.id, decision);
	});
}
