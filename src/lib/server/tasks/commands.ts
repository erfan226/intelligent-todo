import { z } from "zod";
import { eq } from "drizzle-orm";
import { newId, nowIso, type DB } from "../db/db";
import { appendEvent } from "../events/store";
import { enqueueJob } from "../jobs/queue";
import { tasks } from "../db/schema";

const CreateInput = z.object({
	title: z.string().trim().min(1, "Title is required").max(500),
	description: z.string().trim().max(5000).optional()
});

export function createTask(db: DB, input: unknown): { id: string } {
	const data = CreateInput.parse(input);
	const id = newId();
	const now = nowIso();
	// Transactional outbox: state + event + job commit atomically.
	db.transaction((tx) => {
		tx.insert(tasks)
			.values({
				id,
				title: data.title,
				description: data.description ?? null,
				createdAt: now,
				updatedAt: now
			})
			.run();
		appendEvent(tx, {
			type: "TaskCreated",
			aggregateType: "task",
			aggregateId: id,
			payload: { title: data.title }
		});
		enqueueJob(tx, {
			taskId: id,
			type: "classify_task",
			idempotencyKey: `task:${id}:classification:v1`,
			priority: 5
		});
	});
	return { id };
}

export function setTaskStatus(
	db: DB,
	id: string,
	status: "pending" | "in_progress" | "completed" | "cancelled"
): void {
	db.transaction((tx) => {
		const task = tx.select().from(tasks).where(eq(tasks.id, id)).get();
		if (!task) throw new Error(`Task not found: ${id}`);
		const now = nowIso();
		tx.update(tasks)
			.set({ status, updatedAt: now, completedAt: status === "completed" ? now : null })
			.where(eq(tasks.id, id))
			.run();
		const type =
			status === "completed"
				? "TaskCompleted"
				: task.status === "completed" && status === "pending"
					? "TaskReopened"
					: "TaskUpdated";
		appendEvent(tx, {
			type,
			aggregateType: "task",
			aggregateId: id,
			payload: { from: task.status, to: status }
		});
	});
}

export function requestResearch(db: DB, taskId: string): void {
	const task = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
	if (!task) throw new Error(`Task not found: ${taskId}`);
	// New key per request so a deliberate re-run is possible; accidental
	// duplicates within the same millisecond are still deduped by use:enhance.
	enqueueJob(db, {
		taskId,
		type: "research_task",
		idempotencyKey: `task:${taskId}:research:${Date.now()}`
	});
}
