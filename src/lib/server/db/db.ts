import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema";

export type DB = BetterSQLite3Database<typeof schema>;

export function newId(): string {
	return crypto.randomUUID();
}

export function nowIso(): string {
	return new Date().toISOString();
}

export function createDb(path = process.env.DATABASE_PATH ?? "data/app.db"): {
	sqlite: Database.Database;
	db: DB;
} {
	if (path !== ":memory:") mkdirSync(dirname(resolve(path)), { recursive: true });
	const sqlite = new Database(path);
	sqlite.pragma("journal_mode = WAL");
	sqlite.pragma("foreign_keys = ON");
	const db = drizzle(sqlite, { schema });
	runMigrations(db);
	return { sqlite, db };
}

export function runMigrations(db: DB): void {
	try {
		migrate(db, { migrationsFolder: new URL("./migrations", import.meta.url).pathname });
	} catch (err) {
		console.warn(
			"[db] migration failed (run `npm run db:migrate`):",
			err instanceof Error ? err.message : err
		);
	}
}
