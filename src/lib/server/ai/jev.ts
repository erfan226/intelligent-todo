import { z } from "zod";
import { clefDecide } from "./clef";

export const CATEGORIES = [
	"work", "personal", "admin", "learning", "health", "finance",
	"technical", "creative", "communication", "shopping", "planning", "other"
] as const;

export const TASK_TYPES = [
	"action", "research", "decision", "planning", "writing", "communication",
	"learning", "maintenance", "administrative", "purchase", "reflection",
	"reminder", "unknown"
] as const;

export const INTENTS = [
	"do", "find", "understand", "compare", "decide", "create",
	"communicate", "learn", "remember", "plan", "review", "organize"
] as const;

export const COMPLEXITIES = ["trivial", "simple", "moderate", "complex"] as const;

// "What happens next?" — routing hint only, never executed on its own.
export const NEXT_ACTIONS = [
	"none", "schedule", "research", "plan", "write", "summarize",
	"breakdown", "ask_user", "wait", "external_action"
] as const;

const NEXT_ACTIONS_REQUIRING_AI = new Set(["research", "plan", "write", "summarize", "breakdown"]);

export const JevDecision = z.object({
	category: z.string(),
	task_type: z.string(),
	intent: z.string(),
	complexity: z.string(),
	requires_ai: z.boolean(),
	workflow: z.string().nullable(),
	next_action: z.string(),
	confidence: z.number(),
	reasoning: z.string()
});
export type JevDecision = z.infer<typeof JevDecision>;

function buildQuestions() {
	return [
		{ id: "category", prompt: "What broad area does this task belong to?", options: [...CATEGORIES] },
		// Clef caps options at 12; "unknown" stays as our fallback, never a choice.
		{ id: "task_type", prompt: "What kind of task is this?", options: TASK_TYPES.filter((t) => t !== "unknown") },
		{ id: "intent", prompt: "What does the user ultimately want to accomplish?", options: [...INTENTS] },
		{ id: "complexity", prompt: "How complex is this task?", options: [...COMPLEXITIES] },
		{ id: "next_step", prompt: "What should happen next to complete this task?", options: [...NEXT_ACTIONS] }
	];
}

function pick(option: string, list: readonly string[], fallback: string): string {
	return list.includes(option) ? option : fallback;
}

export function mapDecision(model: string, answers: { id: string; option: string; confidence: number }[]): JevDecision {
	const byId = new Map(answers.map((a) => [a.id, a]));
	const category = pick(byId.get("category")?.option ?? "", CATEGORIES, "other");
	const taskType = pick(byId.get("task_type")?.option ?? "", TASK_TYPES, "unknown");
	const intent = pick(byId.get("intent")?.option ?? "", INTENTS, "do");
	const complexity = pick(byId.get("complexity")?.option ?? "", COMPLEXITIES, "simple");
	const nextAction = pick(byId.get("next_step")?.option ?? "", NEXT_ACTIONS, "none");
	const confidence = Math.min(...answers.map((a) => a.confidence));
	return {
		category,
		task_type: taskType,
		intent,
		complexity,
		requires_ai: NEXT_ACTIONS_REQUIRING_AI.has(nextAction),
		workflow: NEXT_ACTIONS_REQUIRING_AI.has(nextAction) ? nextAction : null,
		next_action: nextAction,
		confidence,
		reasoning: `Clef (${model}) classified ${answers.length} questions; next step: ${nextAction}`
	};
}

// Level 1: call the Clef classifier endpoint. Cheap, no LLM involved.
export async function classifyTask(input: { title: string; description?: string | null }): Promise<JevDecision> {
	const state = [input.title, input.description].filter(Boolean).join("\n");
	const res = await clefDecide(state, buildQuestions());
	return mapDecision(res.model ?? "clef", res.answers);
}

// --- Application-level hard rules (Jev is advisory, the app is the authority) ---

// Only this set of LLM workflows is implemented so far.
const IMPLEMENTED_WORKFLOWS = new Set(["research"]);

const REMINDER_RE = /^(remind me\b|reminder[:\s])/i;
const EXPLICIT_AI_RE = /\b(ai:|analy[sz]e this|figure out)\b/i;
const EXPLICIT_NO_AI_RE = /\b(just remind|don'?t analy[sz]e|simple reminder|just (a )?task)\b/i;

export function isDeterministicTask(text: string): boolean {
	return REMINDER_RE.test(text.trim());
}

export interface RouteResult {
	requiresAI: boolean;
	workflow: "research_task" | null;
	reason: string;
}

const noAI = (reason: string): RouteResult => ({ requiresAI: false, workflow: null, reason });

export function route(
	decision: JevDecision,
	input: { title: string; description?: string | null }
): RouteResult {
	const text = `${input.title} ${input.description ?? ""}`;
	if (EXPLICIT_NO_AI_RE.test(text)) return noAI("explicit non-AI intent");
	// Explicit AI intent wins over cost optimization; only research exists today.
	if (EXPLICIT_AI_RE.test(text)) {
		return { requiresAI: true, workflow: "research_task", reason: "explicit AI request" };
	}
	if (isDeterministicTask(text)) return noAI("deterministic task (reminder)");
	if (decision.complexity === "trivial") return noAI("trivial task");
	if (decision.confidence < 0.65) return noAI(`low confidence (${decision.confidence.toFixed(2)})`);
	if (!decision.requires_ai) return noAI("classifier: no AI needed");
	if (!decision.workflow || !IMPLEMENTED_WORKFLOWS.has(decision.workflow)) {
		return noAI(`workflow "${decision.workflow}" not implemented yet`);
	}
	return { requiresAI: true, workflow: "research_task", reason: `${decision.workflow} workflow` };
}
