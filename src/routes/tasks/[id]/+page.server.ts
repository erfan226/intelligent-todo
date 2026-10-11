import { error, fail } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types";
import { db } from "$lib/server/db/client";
import { requestResearch, setTaskStatus } from "$lib/server/tasks/commands";
import { getTask, getTaskEvents, getTaskResults } from "$lib/server/tasks/queries";

const STATUSES = ["pending", "in_progress", "completed", "cancelled"] as const;

export const load: PageServerLoad = ({ params }) => {
	const task = getTask(db, params.id);
	if (!task) error(404, "Task not found");
	return {
		task,
		events: getTaskEvents(db, task.id),
		results: getTaskResults(db, task.id)
	};
};

export const actions: Actions = {
	research: async ({ params }) => {
		requestResearch(db, params.id);
		return { ok: true };
	},
	status: async ({ request }) => {
		const form = await request.formData();
		const id = String(form.get("id") ?? "");
		const status = String(form.get("status") ?? "");
		if (!id || !STATUSES.includes(status as (typeof STATUSES)[number])) {
			return fail(400, { error: "Invalid status change" });
		}
		setTaskStatus(db, id, status as (typeof STATUSES)[number]);
		return { ok: true };
	}
};
