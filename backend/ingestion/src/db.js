import pg from "pg";
const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/inference_logs",
  max: 10,
  idleTimeoutMillis: 30000,
});
