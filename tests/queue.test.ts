import { afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createDb } from "../src/lib/server/db/db";
import { aiJobs, events, tasks } from "../src/lib/server/db/schema";
import { claimNextJob, enqueueJob, failJob, recoverStaleJobs } from "../src/lib/server/jobs/queue";
import { createTask } from "../src/lib/server/tasks/commands";
import { runClassify } from "../src/lib/server/ai/workflows/classify";
import { classifyTask, mapDecision, route, type JevDecision } from "../src/lib/server/ai/jev";

const memDb = () => createDb(":memory:").db;

function clefFetch(answers: Record<string, { option: string; confidence: number }>) {
	return vi.fn(async (_url: string | URL, init?: RequestInit) => {
		const body = JSON.parse(String(init?.body));
		return new Response(
			JSON.stringify({
				ok: true,
				model: "cloudflare/clef-flash",
				degraded: false,
				latencyMs: 12,
				answers: body.questions.map((q: { id: string }) => ({
					id: q.id,
					...(answers[q.id] ?? { option: "other", confidence: 0.5 })
				}))
			}),
			{ status: 200, headers: { "content-type": "application/json" } }
		);
	});
}

function decision(overrides: Partial<JevDecision>): JevDecision {
	return {
		category: "work",
		task_type: "research",
		intent: "compare",
		complexity: "moderate",
		requires_ai: true,
		workflow: "research",
		next_action: "research",
		confidence: 0.9,
		reasoning: "test",
		...overrides
	};
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

// --- Clef mapping ---

it("maps Clef answers into the Jev decision contract", async () => {
	vi.stubGlobal("fetch", clefFetch({
		category: { option: "technical", confidence: 0.92 },
		task_type: { option: "research", confidence: 0.88 },
		intent: { option: "compare", confidence: 0.81 },
		complexity: { option: "moderate", confidence: 0.7 },
		next_step: { option: "research", confidence: 0.9 }
	}));
	const d = await classifyTask({ title: "Compare B2 and R2 storage pricing" });
	expect(d.category).toBe("technical");
	expect(d.task_type).toBe("research");
	expect(d.intent).toBe("compare");
	expect(d.complexity).toBe("moderate");
	expect(d.requires_ai).toBe(true);
	expect(d.workflow).toBe("research");
	expect(d.confidence).toBe(0.7); // min across answers
});

it("coerces out-of-vocabulary Clef options to safe fallbacks", () => {
	const d = mapDecision("test", [
		{ id: "category", option: "galactic", confidence: 0.9 },
		{ id: "task_type", option: "quest", confidence: 0.9 },
		{ id: "intent", option: "conquer", confidence: 0.9 },
		{ id: "complexity", option: "cosmic", confidence: 0.9 },
		{ id: "next_step", option: "party", confidence: 0.9 }
	]);
	expect(d.category).toBe("other");
	expect(d.task_type).toBe("unknown");
	expect(d.intent).toBe("do");
	expect(d.complexity).toBe("simple");
	expect(d.next_action).toBe("none");
	expect(d.requires_ai).toBe(false);
});

// --- Routing hard rules (deterministic, independent of Clef) ---

describe("route()", () => {
	it("simple action → no AI", () => {
		expect(route(decision({ task_type: "action", complexity: "trivial", requires_ai: false, workflow: null, next_action: "none" }), { title: "Buy milk" })).toMatchObject({ requiresAI: false });
	});

	it("reminder → no AI", () => {
		expect(route(decision({ task_type: "reminder", requires_ai: false, workflow: null, next_action: "schedule" }), { title: "Remind me tomorrow to call Ali" })).toMatchObject({ requiresAI: false, reason: expect.stringContaining("deterministic") });
	});

	it("research → research_task job", () => {
		expect(route(decision({}), { title: "Research B2 vs R2 pricing" })).toEqual({ requiresAI: true, workflow: "research_task", reason: "research workflow" });
	});

	it("planning classification routes to no job until that workflow exists", () => {
		const r = route(decision({ task_type: "planning", workflow: "planning", next_action: "plan" }), { title: "Plan migration to Germany" });
		expect(r.requiresAI).toBe(false);
		expect(r.reason).toContain("not implemented");
	});

	it("low confidence → no AI", () => {
		expect(route(decision({ confidence: 0.4 }), { title: "Something vague" })).toMatchObject({ requiresAI: false, reason: expect.stringContaining("low confidence") });
	});

	it("classifier says no AI → no AI", () => {
		expect(route(decision({ requires_ai: false, workflow: null, next_action: "none" }), { title: "Deploy staging" })).toMatchObject({ requiresAI: false });
	});

	it('explicit "analyze this" → AI even when the classifier declined', () => {
		expect(route(decision({ requires_ai: false, workflow: null }), { title: "Analyze this invoice" })).toEqual({ requiresAI: true, workflow: "research_task", reason: "explicit AI request" });
	});

	it("explicit non-AI intent beats classification", () => {
		expect(route(decision({}), { title: "Just remind me about the deadline" })).toMatchObject({ requiresAI: false, reason: "explicit non-AI intent" });
	});
});

// --- Outbox + worker integration ---

it("createTask writes task + TaskCreated event + classify job atomically", () => {
	const db = memDb();
	const task = createTask(db, { title: "Research whether we should move BBB recordings" });
	const taskEvents = db.select().from(events).where(eq(events.aggregateId, task.id)).all();
	expect(taskEvents.map((e) => e.type)).toContain("TaskCreated");
	const jobs = db.select().from(aiJobs).all();
	expect(jobs).toHaveLength(1);
	expect(jobs[0].type).toBe("classify_task");
});

it("runClassify persists Clef classification and routes research tasks to a job", async () => {
	vi.stubGlobal("fetch", clefFetch({
		category: { option: "technical", confidence: 0.95 },
		task_type: { option: "research", confidence: 0.9 },
		intent: { option: "compare", confidence: 0.9 },
		complexity: { option: "complex", confidence: 0.85 },
		next_step: { option: "research", confidence: 0.9 }
	}));
	const db = memDb();
	createTask(db, { title: "Find out whether moving our BBB recordings to B2 would save money" });
	const job = claimNextJob(db)!;
	expect(job.type).toBe("classify_task");
	await runClassify(db, job);

	const task = db.select().from(tasks).all()[0];
	expect(task.category).toBe("technical");
	expect(task.complexity).toBe("complex");
	expect(task.aiStatus).toBe("processing"); // research job enqueued

	const types = db.select().from(aiJobs).all().map((j) => j.type).sort();
	expect(types).toEqual(["classify_task", "research_task"]);

	const classified = db.select().from(events).all().find((e) => e.type === "TaskClassified");
	expect(classified?.payload).toMatchObject({ task_type: "research" });
});

it("runClassify leaves low-AI tasks idle with no follow-up job", async () => {
	vi.stubGlobal("fetch", clefFetch({
		category: { option: "personal", confidence: 0.95 },
		task_type: { option: "action", confidence: 0.95 },
		intent: { option: "do", confidence: 0.95 },
		complexity: { option: "trivial", confidence: 0.95 },
		next_step: { option: "none", confidence: 0.95 }
	}));
	const db = memDb();
	createTask(db, { title: "Buy milk" });
	const job = claimNextJob(db)!;
	await runClassify(db, job);

	const task = db.select().from(tasks).all()[0];
	expect(task.aiStatus).toBe("idle");
	expect(db.select().from(aiJobs).all()).toHaveLength(1); // classify only
});

// --- Queue mechanics ---

it("enqueueJob dedupes on idempotency key", () => {
	const db = memDb();
	expect(enqueueJob(db, { taskId: null, type: "research_task", idempotencyKey: "k1" })).not.toBeNull();
	expect(enqueueJob(db, { taskId: null, type: "research_task", idempotencyKey: "k1" })).toBeNull();
	expect(db.select().from(aiJobs).all()).toHaveLength(1);
});

it("claiming is atomic: a claimed job cannot be claimed twice", () => {
	const db = memDb();
	enqueueJob(db, { taskId: null, type: "classify_task", idempotencyKey: "k" });
	expect(claimNextJob(db)?.status).toBe("running");
	expect(claimNextJob(db)).toBeNull();
});

it("failed job retries with backoff, then fails permanently", () => {
	const db = memDb();
	enqueueJob(db, { taskId: null, type: "classify_task", idempotencyKey: "k", maxAttempts: 2 });
	const job = claimNextJob(db)!;
	failJob(db, job, "boom");
	const retried = db.select().from(aiJobs).all()[0];
	expect(retried.status).toBe("pending");
	expect(retried.availableAt > new Date().toISOString()).toBe(true);
	db.update(aiJobs).set({ availableAt: new Date(Date.now() - 1000).toISOString() }).run();
	const again = claimNextJob(db)!;
	failJob(db, again, "boom again");
	expect(db.select().from(aiJobs).all()[0].status).toBe("failed");
});

it("stale running jobs are recovered to pending", () => {
	const db = memDb();
	enqueueJob(db, { taskId: null, type: "classify_task", idempotencyKey: "k" });
	claimNextJob(db);
	db.update(aiJobs).set({ startedAt: new Date(Date.now() - 10 * 60_000).toISOString() }).run();
	expect(recoverStaleJobs(db, new Date(Date.now() - 5 * 60_000).toISOString())).toBe(1);
	expect(db.select().from(aiJobs).all()[0].status).toBe("pending");
});
