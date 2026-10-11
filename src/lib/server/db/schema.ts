import { sqliteTable, text, integer, primaryKey, index } from "drizzle-orm/sqlite-core";

export const projects = sqliteTable("projects", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	description: text("description"),
	status: text("status").notNull().default("active"),
	createdAt: text("created_at").notNull(),
	updatedAt: text("updated_at").notNull()
});

export const tasks = sqliteTable(
	"tasks",
	{
		id: text("id").primaryKey(),
		title: text("title").notNull(),
		description: text("description"),
		status: text("status").notNull().default("pending"),
		priority: integer("priority").notNull().default(0),

		category: text("category"),
		taskType: text("task_type"),
		intent: text("intent"),
		complexity: text("complexity"),

		projectId: text("project_id").references(() => projects.id),

		dueAt: text("due_at"),
		scheduledAt: text("scheduled_at"),

		aiStatus: text("ai_status").notNull().default("idle"),
		latestAiJobId: text("latest_ai_job_id"),

		createdAt: text("created_at").notNull(),
		updatedAt: text("updated_at").notNull(),
		completedAt: text("completed_at")
	},
	(t) => [index("tasks_status_idx").on(t.status), index("tasks_project_idx").on(t.projectId)]
);

export const tags = sqliteTable("tags", {
	id: text("id").primaryKey(),
	name: text("name").notNull().unique(),
	createdAt: text("created_at").notNull()
});

export const taskTags = sqliteTable(
	"task_tags",
	{
		taskId: text("task_id")
			.notNull()
			.references(() => tasks.id),
		tagId: text("tag_id")
			.notNull()
			.references(() => tags.id)
	},
	(t) => [primaryKey({ columns: [t.taskId, t.tagId] })]
);

export const events = sqliteTable(
	"events",
	{
		id: text("id").primaryKey(),
		type: text("type").notNull(),
		aggregateType: text("aggregate_type").notNull(),
		aggregateId: text("aggregate_id").notNull(),
		payload: text("payload", { mode: "json" })
			.$type<Record<string, unknown>>()
			.notNull()
			.default({}),
		createdAt: text("created_at").notNull()
	},
	(t) => [index("events_aggregate_idx").on(t.aggregateType, t.aggregateId)]
);

export const aiJobs = sqliteTable(
	"ai_jobs",
	{
		id: text("id").primaryKey(),
		taskId: text("task_id").references(() => tasks.id),

		type: text("type").notNull(),
		status: text("status").notNull().default("pending"),

		priority: integer("priority").notNull().default(0),
		attempts: integer("attempts").notNull().default(0),
		maxAttempts: integer("max_attempts").notNull().default(4),

		idempotencyKey: text("idempotency_key").notNull().unique(),

		input: text("input", { mode: "json" }).$type<Record<string, unknown> | null>(),
		output: text("output", { mode: "json" }).$type<Record<string, unknown> | null>(),
		error: text("error"),

		availableAt: text("available_at").notNull(),
		startedAt: text("started_at"),
		completedAt: text("completed_at"),

		createdAt: text("created_at").notNull(),
		updatedAt: text("updated_at").notNull()
	},
	(t) => [index("ai_jobs_queue_idx").on(t.status, t.availableAt)]
);

export const aiResults = sqliteTable("ai_results", {
	id: text("id").primaryKey(),
	taskId: text("task_id")
		.notNull()
		.references(() => tasks.id),
	jobId: text("job_id")
		.notNull()
		.references(() => aiJobs.id),
	type: text("type").notNull(),
	content: text("content"),
	structuredData: text("structured_data", { mode: "json" }).$type<Record<string, unknown> | null>(),
	model: text("model"),
	provider: text("provider"),
	inputTokens: integer("input_tokens"),
	outputTokens: integer("output_tokens"),
	latencyMs: integer("latency_ms"),
	createdAt: text("created_at").notNull()
});
