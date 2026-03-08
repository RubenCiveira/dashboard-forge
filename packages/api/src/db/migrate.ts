import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { db } from "./index.js";
import { resolve } from "path";

const migrationsFolder = resolve(import.meta.dir, "../../drizzle");

migrate(db, { migrationsFolder });
console.log("✓ Migrations applied");
