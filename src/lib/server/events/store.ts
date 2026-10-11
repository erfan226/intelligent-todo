import { events } from "../db/schema";
import { newId, nowIso, type DB } from "../db/db";

export function appendEvent(
	db: DB,
	e: { type: string; aggregateType: string; aggregateId: string; payload?: Record<string, unknown> }
): void {
	db.insert(events)
		.values({
			id: newId(),
			type: e.type,
			aggregateType: e.aggregateType,
			aggregateId: e.aggregateId,
			payload: e.payload ?? {},
			createdAt: nowIso()
		})
		.run();
}
