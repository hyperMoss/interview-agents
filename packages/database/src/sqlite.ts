import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { mkdirSync, chmodSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
type QueryResultRow = Record<string, unknown>;
type QueryResult = { rows: QueryResultRow[]; rowCount: number };

export function sqlitePath(url: string) {
  if (!url.startsWith('file:')||/[?#\0]/.test(url)||url.endsWith('/')||url==='file:') throw new Error('SQLITE_URL_REQUIRED: use a local file: database URL');
  return url.startsWith('file:/') ? fileURLToPath(url) : resolve(url.slice(5));
}
export function sqliteClient(url: string) {
  const file=sqlitePath(url);
  mkdirSync(dirname(file),{recursive:true,mode:0o700});
  const client=new DatabaseSync(file);
  client.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=0;');
  chmodSync(file,0o600);
  return client;
}
const jsonColumns = new Set(['payload','state','response','questions','warnings','policy','model_source','observed','decision','match','greeting','owner_review','model','evidence','original','edited','preparation','posting_snapshot']);
const booleanColumns = new Set(['active','remember','has_key','fresh']);
function value(raw: unknown): SQLInputValue {
  if (raw === null || raw === undefined) return null;
  if (raw instanceof Date) return raw.toISOString().replace(/(\.\d{3})Z$/,'$1000Z');
  if (typeof raw === 'boolean') return Number(raw);
  if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'bigint' || raw instanceof Uint8Array) return raw;
  return JSON.stringify(raw);
}
export async function retryBusy<T>(action: () => Promise<T>): Promise<T> {
  const deadline=Date.now()+70000;
  for(;;) {
    try { return await action(); }
    catch(error) {
      if (!(error instanceof Error) || !/SQLITE_BUSY|database is locked/.test(error.message) || Date.now()>=deadline) throw error;
      await new Promise(resolve=>setTimeout(resolve,25));
    }
  }
}
function decode(row: QueryResultRow) {
  const result: QueryResultRow={};
  for(const [key,raw] of Object.entries(row)) {
    if (typeof raw==='string' && jsonColumns.has(key) && /^[\[{]/.test(raw)) result[key]=JSON.parse(raw);
    else if (typeof raw==='string' && /(?:_at|lease_until)$/.test(key)) result[key]=new Date(raw);
    else if (booleanColumns.has(key) && typeof raw==='number') result[key]=Boolean(raw);
    else result[key]=raw;
  }
  return result;
}
export class Pool {
  readonly client: DatabaseSync;
  readonly url:string;
  constructor(options: { connectionString?: string; max?: number; connectionTimeoutMillis?: number; query_timeout?: number }) {
    if (!options.connectionString) throw new Error('SQLITE_URL_REQUIRED');
    this.url=options.connectionString;
    this.client=sqliteClient(this.url);
  }
  on(_event: string, _callback: (...args: unknown[])=>void) { return this; }
  async query(sql: string, params: readonly unknown[] = []) { return this.execute(this.client,sql,params); }
  async execute(target: DatabaseSync, sql: string, params: readonly unknown[]):Promise<Pick<QueryResult,'rows'|'rowCount'>> {
    const args: SQLInputValue[]=[];
    const statement=sql.replace(/\$(\d+)/g,(_,index:string)=>{args.push(value(params[Number(index)-1]));return '?';});
    return retryBusy(async()=>{
      const stmt=target.prepare(statement);
      if(stmt.columns().length){const rows=stmt.all(...args).map(decode);return{rows,rowCount:rows.length};}
      const result=stmt.run(...args);return{rows:[],rowCount:Number(result.changes)};
    });
  }
  async connect() { return new PoolClient(this); }
  async end() { this.client.close(); }
}
export class PoolClient {
  readonly client: DatabaseSync;
  private active=false;
  constructor(private readonly pool:Pool) {this.client=sqliteClient(pool.url);}
  async query(sql:string,params:readonly unknown[] = []) {
    if(sql.toUpperCase()==='BEGIN'){const result=await this.pool.execute(this.client,'BEGIN IMMEDIATE',[]);this.active=true;return result;}
    if(sql.toUpperCase()==='ROLLBACK'&&!this.active)return{rows:[],rowCount:0};
    if(sql.toUpperCase()==='COMMIT'||sql.toUpperCase()==='ROLLBACK'){const result=await this.pool.execute(this.client,sql,[]);this.active=false;return result;}
    return this.pool.execute(this.client,sql,params);
  }
  release() { this.client.close(); }
}
