import type { DB } from "../../src/lib/server/db/db";
import type { JobRow } from "../../src/lib/server/jobs/queue";
import { runClassify } from "../../src/lib/server/ai/workflows/classify";
import { runResearch } from "../../src/lib/server/ai/workflows/research";

// Intentionally boring dispatcher: one case per job type.
export function processJob(db: DB, job: JobRow): Promise<void> | void {
	switch (job.type) {
		case "classify_task":
			return runClassify(db, job);
		case "research_task":
			return runResearch(db, job);
		default:
			throw new Error(`Unknown job type: ${job.type}`);
	}
}
