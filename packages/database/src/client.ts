import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';
export function openDatabase(url: string) {
  const pool = new Pool({ connectionString: url, max: 10, connectionTimeoutMillis: 5000 });
  return { pool, db: drizzle(pool, { schema }) };
}
