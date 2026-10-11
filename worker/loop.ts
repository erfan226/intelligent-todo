import { createDb } from "../src/lib/server/db/db";
import { claimNextJob, failJob, recoverStaleJobs } from "../src/lib/server/jobs/queue";
import { processJob } from "./processors/ai";

const POLL_MS = Number(process.env.WORKER_POLL_MS ?? 1000);
const STALE_TIMEOUT_MS = Number(process.env.WORKER_STALE_TIMEOUT_MS ?? 5 * 60_000);
const RECOVERY_EVERY_MS = Number(process.env.WORKER_RECOVERY_EVERY_MS ?? 30_000);

function log(msg: string, fields: Record<string, unknown> = {}): void {
	const extra = Object.entries(fields)
		.map(([k, v]) => `${k}=${v}`)
		.join(" ");
	console.log(`[AI] ${msg}${extra ? " " + extra : ""}`);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function runLoop(): Promise<void> {
	const { db } = createDb();
	let running = true;
	process.on("SIGINT", () => {
		running = false;
	});
	process.on("SIGTERM", () => {
		running = false;
	});

	log(`worker started poll=${POLL_MS}ms staleTimeout=${STALE_TIMEOUT_MS}ms`);
	let lastRecovery = 0;

	while (running) {
		try {
			if (Date.now() - lastRecovery > RECOVERY_EVERY_MS) {
				const recovered = recoverStaleJobs(
					db,
					new Date(Date.now() - STALE_TIMEOUT_MS).toISOString()
				);
				if (recovered > 0) log(`recovered=${recovered} stale jobs`);
				lastRecovery = Date.now();
			}

			const job = claimNextJob(db);
			if (!job) {
				await sleep(POLL_MS);
				continue;
			}

			const t0 = Date.now();
			log(`job=${job.id} task=${job.taskId} type=${job.type} attempt=${job.attempts} status=started`);
			try {
				await processJob(db, job);
				log(`job=${job.id} duration=${Date.now() - t0}ms status=completed`);
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				failJob(db, job, message);
				log(`job=${job.id} attempt=${job.attempts} status=failed`, { error: message });
			}
		} catch (err) {
			log("loop error", { error: err instanceof Error ? err.message : String(err) });
			await sleep(POLL_MS);
		}
	}

	log("worker stopped");
}
