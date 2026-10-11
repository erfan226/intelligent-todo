import { and, asc, desc, eq, lte } from "drizzle-orm";
import { newId, nowIso, type DB } from "../db/db";
import { appendEvent } from "../events/store";
import { aiJobs, tasks } from "../db/schema";

export type JobType = "classify_task" | "research_task";

export type JobRow = typeof aiJobs.$inferSelect;

const BACKOFF_SECONDS = [5, 30, 300];

export function backoffSeconds(attempt: number): number {
	const base = BACKOFF_SECONDS[Math.min(attempt - 1, BACKOFF_SECONDS.length - 1)];
	return Math.round(base * (0.8 + Math.random() * 0.4));
}

// Transactional outbox entry: caller wraps this in the same transaction as the
// state change, so state + event + job commit atomically.
export function enqueueJob(
	db: DB,
	j: {
		taskId: string | null;
		type: JobType;
		idempotencyKey: string;
		priority?: number;
		input?: Record<string, unknown>;
		delayMs?: number;
		maxAttempts?: number;
	}
): JobRow | null {
	return db.transaction((tx) => {
		const now = nowIso();
		const inserted = tx
			.insert(aiJobs)
			.values({
				id: newId(),
				taskId: j.taskId,
				type: j.type,
				status: "pending",
				priority: j.priority ?? 0,
				attempts: 0,
				maxAttempts: j.maxAttempts ?? 4,
				idempotencyKey: j.idempotencyKey,
				input: j.input ?? null,
				availableAt: new Date(Date.now() + (j.delayMs ?? 0)).toISOString(),
				createdAt: now,
				updatedAt: now
			})
			.onConflictDoNothing({ target: aiJobs.idempotencyKey })
			.returning()
			.get();
		if (!inserted) return null;
		if (j.taskId) {
			tx.update(tasks)
				.set({ aiStatus: "processing", latestAiJobId: inserted.id, updatedAt: now })
				.where(eq(tasks.id, j.taskId))
				.run();
		}
		appendEvent(tx, {
			type: "AIJobCreated",
			aggregateType: "ai_job",
			aggregateId: inserted.id,
			payload: { jobId: inserted.id, taskId: j.taskId, jobType: j.type }
		});
		return inserted;
	});
}

export function claimNextJob(db: DB): JobRow | null {
	return db.transaction((tx) => {
		const now = nowIso();
		const candidate = tx
			.select()
			.from(aiJobs)
			.where(and(eq(aiJobs.status, "pending"), lte(aiJobs.availableAt, now)))
			.orderBy(desc(aiJobs.priority), asc(aiJobs.createdAt))
			.limit(1)
			.get();
		if (!candidate) return null;
		const claimed = tx
			.update(aiJobs)
			.set({ status: "running", startedAt: now, updatedAt: now, attempts: candidate.attempts + 1 })
			.where(and(eq(aiJobs.id, candidate.id), eq(aiJobs.status, "pending")))
			.run();
		if (claimed.changes !== 1) return null;
		if (candidate.taskId) {
			tx.update(tasks)
				.set({ aiStatus: "processing", latestAiJobId: candidate.id, updatedAt: now })
				.where(eq(tasks.id, candidate.taskId))
				.run();
		}
		appendEvent(tx, {
			type: "AIJobStarted",
			aggregateType: "ai_job",
			aggregateId: candidate.id,
			payload: { jobId: candidate.id, taskId: candidate.taskId, jobType: candidate.type, attempt: candidate.attempts + 1 }
		});
		return { ...candidate, status: "running", startedAt: now, attempts: candidate.attempts + 1 };
	});
}

// Low-level completion for use inside a processor's own transaction.
export function markJobCompleted(tx: DB, jobId: string, taskId: string | null, output: unknown): void {
	const now = nowIso();
	tx.update(aiJobs)
		.set({ status: "completed", output: output as Record<string, unknown>, completedAt: now, updatedAt: now })
		.where(eq(aiJobs.id, jobId))
		.run();
	appendEvent(tx, {
		type: "AIJobCompleted",
		aggregateType: "ai_job",
		aggregateId: jobId,
		payload: { jobId, taskId }
	});
}

export function failJob(db: DB, job: JobRow, error: string): void {
	db.transaction((tx) => {
		const now = nowIso();
		if (job.attempts >= job.maxAttempts) {
			tx.update(aiJobs)
				.set({ status: "failed", error, completedAt: now, updatedAt: now })
				.where(eq(aiJobs.id, job.id))
				.run();
			appendEvent(tx, {
				type: "AIJobFailed",
				aggregateType: "ai_job",
				aggregateId: job.id,
				payload: { jobId: job.id, taskId: job.taskId, jobType: job.type, error, attempts: job.attempts }
			});
			if (job.taskId) {
				tx.update(tasks)
					.set({ aiStatus: "failed", updatedAt: now })
					.where(and(eq(tasks.id, job.taskId), eq(tasks.latestAiJobId, job.id)))
					.run();
			}
		} else {
			const wait = backoffSeconds(job.attempts);
			tx.update(aiJobs)
				.set({
					status: "pending",
					error,
					availableAt: new Date(Date.now() + wait * 1000).toISOString(),
					updatedAt: now
				})
				.where(eq(aiJobs.id, job.id))
				.run();
		}
	});
}

export function recoverStaleJobs(db: DB, staleBeforeIso: string): number {
	return db.transaction((tx) => {
		const now = nowIso();
		const stale = tx
			.select()
			.from(aiJobs)
			.where(and(eq(aiJobs.status, "running"), lte(aiJobs.startedAt, staleBeforeIso)))
			.all();
		for (const job of stale) {
			if (job.attempts >= job.maxAttempts) {
				tx.update(aiJobs)
					.set({ status: "failed", error: "stale running job exceeded max attempts", completedAt: now, updatedAt: now })
					.where(eq(aiJobs.id, job.id))
					.run();
				appendEvent(tx, {
					type: "AIJobFailed",
					aggregateType: "ai_job",
					aggregateId: job.id,
					payload: { jobId: job.id, taskId: job.taskId, jobType: job.type, error: "stale job exceeded max attempts" }
				});
				if (job.taskId) {
					tx.update(tasks)
						.set({ aiStatus: "failed", updatedAt: now })
						.where(and(eq(tasks.id, job.taskId), eq(tasks.latestAiJobId, job.id)))
						.run();
				}
			} else {
				tx.update(aiJobs)
					.set({ status: "pending", error: "recovered after worker crash", availableAt: now, updatedAt: now })
					.where(eq(aiJobs.id, job.id))
					.run();
			}
		}
		return stale.length;
	});
}
