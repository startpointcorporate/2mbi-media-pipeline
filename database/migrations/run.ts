import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

async function main() {
  const databaseUrl =
    process.env.DATABASE_URL ??
    "postgres://postgres:postgres@localhost:5432/media_pipeline";

  const pool = new pg.Pool({ connectionString: databaseUrl });

  try {
    const files = readdirSync(__dirname)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    if (files.length === 0) {
      console.log("No migration files found.");
      process.exit(0);
    }

    for (const file of files) {
      const path = join(__dirname, file);
      const sql = readFileSync(path, "utf-8");

      console.log(`Running migration: ${file}...`);
      await pool.query(sql);
      console.log(`  ✓ ${file} applied successfully`);
    }

    console.log(`\nAll ${files.length} migration(s) applied.`);
    process.exit(0);
  } catch (err) {
    console.error("Migration failed:", err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
