# Intelligent Todo

Personal task manager where AI classifies, routes, and enriches tasks in the
background — built per the architecture spec: SvelteKit (Svelte 5) + Tailwind +
Drizzle ORM + SQLite (WAL) + a separate Node worker process sharing the same
database.

```
COMMAND → transaction(STATE + EVENT + JOB) → worker → Jev → LLM → validated result → UI
```

## Quick start

```bash
npm install
npm run dev        # web app on http://localhost:5173 (auto-applies migrations)
npm run worker     # in a second terminal
```

The SQLite database lives at `data/app.db` (override with `DATABASE_PATH`).

## Optional: LLM

Jev is now the [Clef](https://clef-flash.com) classifier (`https://clef-flash.com/api/decide`,
override with `CLEF_ENDPOINT`): every new task is classified via multiple-choice questions
(category, task type, intent, complexity, next step), then deterministic application rules decide
whether an LLM job is justified (reminders/trivial tasks never escalate; confidence < 0.65 → no AI;
explicit "analyze this" always escalates).

To enable the LLM research workflow, set:

```bash
OPENAI_API_KEY=sk-...          # required
OPENAI_BASE_URL=...            # optional, any OpenAI-compatible API
OPENAI_MODEL=gpt-4o-mini       # optional
```

Without a key, tasks are still classified; research jobs fail with a clear
error. With a key, tasks that look like research automatically get an AI
research run.

## Commands

| Command            | What it does                  |
| ------------------ | ----------------------------- |
| `npm run dev`      | web app (dev)                 |
| `npm run build` / `npm run start` | production web |
| `npm run worker`   | background AI worker          |
| `npm run db:migrate` | apply migrations manually   |
| `npm run db:generate` | generate migration from schema |
| `npm run test`     | vitest (queue, Jev, outbox)   |

## Layout

- `src/lib/server/db/` — Drizzle schema + SQLite client (WAL, FKs on)
- `src/lib/server/events/` — append-only event log
- `src/lib/server/jobs/` — SQLite-backed queue: atomic claim, retry/backoff, stale recovery
- `src/lib/server/ai/` — Jev classifier, provider interface, prompts, workflows
- `src/lib/server/tasks/` — commands (transactional outbox) and queries
- `worker/` — polling worker loop + job dispatcher
- `src/routes/` — task list + task detail UI (polls every 2.5s while processing)
