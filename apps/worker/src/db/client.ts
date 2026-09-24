import postgres from "postgres";

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://admin:secret@localhost:5432/devmind";
const CONCURRENCY = Number(process.env.WORKER_CONCURRENCY ?? 5);

// Single shared Postgres client for the whole worker process. Pool is sized to
// concurrency + 1 so every in-flight job can hold a connection with one spare
// for the health check.
export const sql = postgres(DATABASE_URL, { max: CONCURRENCY + 1 });
