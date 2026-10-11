import { and, desc, eq, or, sql } from "drizzle-orm";
import { aiResults, events, tasks } from "../db/schema";
import type { DB } from "../db/db";

export function listTasks(db: DB) {
	return db.select().from(tasks).orderBy(desc(tasks.createdAt)).all();
}

export function getTask(db: DB, id: string) {
	return db.select().from(tasks).where(eq(tasks.id, id)).get() ?? null;
}

export function getTaskEvents(db: DB, taskId: string) {
	return db
		.select()
		.from(events)
		.where(
			or(
				and(eq(events.aggregateType, "task"), eq(events.aggregateId, taskId)),
				sql`json_extract(${events.payload}, '$.taskId') = ${taskId}`
			)
		)
		.orderBy(desc(events.createdAt))
		.all();
}

export function getTaskResults(db: DB, taskId: string) {
	return db
		.select()
		.from(aiResults)
		.where(eq(aiResults.taskId, taskId))
		.orderBy(desc(aiResults.createdAt))
		.all();
}
