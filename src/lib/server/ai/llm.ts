export interface LLMResult {
	data: unknown;
	model: string;
	provider: string;
	inputTokens: number | null;
	outputTokens: number | null;
	latencyMs: number;
}

// Business logic depends on this interface, never on an SDK directly.
export interface AIProvider {
	complete(req: { system: string; user: string }): Promise<LLMResult>;
}

export function getProvider(): AIProvider | null {
	const apiKey = process.env.OPENAI_API_KEY;
	if (!apiKey) return null;
	return openaiProvider({
		baseUrl: process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
		apiKey,
		model: process.env.OPENAI_MODEL ?? "gpt-4o-mini"
	});
}

function openaiProvider(cfg: { baseUrl: string; apiKey: string; model: string }): AIProvider {
	return {
		async complete({ system, user }) {
			const t0 = Date.now();
			const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
				method: "POST",
				headers: {
					"content-type": "application/json",
					authorization: `Bearer ${cfg.apiKey}`
				},
				body: JSON.stringify({
					model: cfg.model,
					temperature: 0.2,
					response_format: { type: "json_object" },
					messages: [
						{ role: "system", content: system },
						{ role: "user", content: user }
					]
				})
			});
			if (!res.ok) {
				throw new Error(`LLM HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
			}
			const body = (await res.json()) as {
				model?: string;
				choices?: { message?: { content?: string } }[];
				usage?: { prompt_tokens?: number; completion_tokens?: number };
			};
			const content = body.choices?.[0]?.message?.content;
			if (typeof content !== "string") throw new Error("LLM returned no message content");
			return {
				data: parseJsonLoose(content),
				model: body.model ?? cfg.model,
				provider: "openai-compatible",
				inputTokens: body.usage?.prompt_tokens ?? null,
				outputTokens: body.usage?.completion_tokens ?? null,
				latencyMs: Date.now() - t0
			};
		}
	};
}

function parseJsonLoose(text: string): unknown {
	const trimmed = text.trim().replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
	return JSON.parse(trimmed);
}
