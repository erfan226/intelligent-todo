import { z } from "zod";

export interface ClefQuestion {
	id: string;
	prompt: string;
	options: string[];
}

const ClefResponse = z.object({
	ok: z.boolean(),
	model: z.string().optional(),
	degraded: z.boolean().optional(),
	latencyMs: z.number().optional(),
	answers: z
		.array(
			z.object({
				id: z.string(),
				option: z.string(),
				confidence: z.number()
			})
		)
		.min(1)
});

export type ClefResponse = z.infer<typeof ClefResponse>;

const ENDPOINT = process.env.CLEF_ENDPOINT ?? "https://clef-flash.com/api/decide";

export async function clefDecide(state: string, questions: ClefQuestion[]): Promise<ClefResponse> {
	const res = await fetch(ENDPOINT, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ state, questions }),
		signal: AbortSignal.timeout(10_000)
	});
	if (!res.ok) throw new Error(`Clef HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
	const body = ClefResponse.parse(await res.json());
	if (!body.ok) throw new Error("Clef returned ok=false");
	return body;
}
