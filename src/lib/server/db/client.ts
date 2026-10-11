import { createDb } from "./db";

// Web-app singleton. Worker creates its own instance in worker/loop.ts.
export const { db } = createDb();
