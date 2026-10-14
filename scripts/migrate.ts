import { readFile,readdir } from 'node:fs/promises';
import { Pool } from 'pg';
const pool = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL });
try {const directory=new URL('../infra/migrations/',import.meta.url);for(const file of (await readdir(directory)).filter(name=>name.endsWith('.sql')).sort())await pool.query(await readFile(new URL(file,directory),'utf8'));}
finally { await pool.end(); }
