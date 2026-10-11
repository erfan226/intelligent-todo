import { fail } from "@sveltejs/kit";
import { z } from "zod";
import type { Actions, PageServerLoad } from "./$types";
import { db } from "$lib/server/db/client";
import { createTask, setTaskStatus } from "$lib/server/tasks/commands";
import { listTasks } from "$lib/server/tasks/queries";

const STATUSES = ["pending", "in_progress", "completed", "cancelled"] as const;

export const load: PageServerLoad = () => {
	return { tasks: listTasks(db) };
};

export const actions: Actions = {
	create: async ({ request }) => {
		const form = await request.formData();
		try {
			createTask(db, {
				title: form.get("title"),
				description: form.get("description") || undefined
			});
		} catch (err) {
			const message =
				err instanceof z.ZodError
					? err.issues[0]?.message ?? "Invalid input"
					: "Invalid input";
			return fail(400, { error: message });
		}
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
