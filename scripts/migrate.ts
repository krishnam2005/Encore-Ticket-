import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  const client = new Client({ connectionString });
  await client.connect();
  try {
    for (const file of ["schema.sql", "seed.sql"]) {
      await client.query(readFileSync(join(process.cwd(), "db", file), "utf8"));
      console.log(`applied db/${file}`);
    }
  } finally {
    await client.end();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
