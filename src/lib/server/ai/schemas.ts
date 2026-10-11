import { z } from "zod";

export const ResearchOutput = z.object({
	summary: z.string(),
	findings: z
		.array(z.object({ title: z.string(), content: z.string() }))
		.min(1)
		.max(10),
	recommendation: z.string(),
	next_actions: z.array(z.string()).max(10).default([])
});
export type ResearchResult = z.infer<typeof ResearchOutput>;
