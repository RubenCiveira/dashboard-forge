import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "./schema.js";
import { resolve } from "path";
import { mkdirSync } from "fs";

const DB_DIR = resolve(import.meta.dir, "../../../../data");
const DB_PATH = resolve(DB_DIR, "agentforge.db");

mkdirSync(DB_DIR, { recursive: true });

const sqlite = new Database(DB_PATH);
sqlite.run("PRAGMA journal_mode = WAL");
sqlite.run("PRAGMA foreign_keys = ON");

/** Drizzle ORM database instance */
export const db = drizzle(sqlite, { schema });

/** Raw bun:sqlite client (for migrations and DDL) */
export { sqlite };

export { schema };
