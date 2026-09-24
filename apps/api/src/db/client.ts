import postgres from "postgres";

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://admin:secret@localhost:5432/devmind";

// Single shared Postgres client for the whole API process. `postgres.js` pools
// internally — do NOT create additional instances per module or you'll leak
// connections. Max is small on purpose; Postgres is not the bottleneck here.
export const sql = postgres(DATABASE_URL, { max: 5 });
