import { z } from 'zod';
import { drizzle } from 'drizzle-orm/sqlite-proxy';
import { Pool, retryBusy } from './sqlite';
import * as schema from './schema';
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
function orm(client:DatabaseSync) {
  return drizzle(async(sql,params:SQLInputValue[],method)=>retryBusy(async()=>{
    const stmt=client.prepare(sql);
    if(method==='run'){stmt.run(...params);return{rows:[]};}
    stmt.setReturnArrays(true);
    const rows=z.array(z.array(z.unknown())).parse(stmt.all(...params));
    return{rows:method==='get'?(rows[0]??[]):rows};
  }),{schema});
}
export function openDatabase(url:string) {
  const pool=new Pool({connectionString:url});
  const base=orm(pool.client);
  const db={select:base.select.bind(base),insert:base.insert.bind(base),update:base.update.bind(base),
    async transaction<T>(action:(tx:ReturnType<typeof orm>)=>Promise<T>) {
      const client=await pool.connect();
      try{await client.query('BEGIN');const result=await action(orm(client.client));await client.query('COMMIT');return result;}
      catch(error){await client.query('ROLLBACK');throw error;}
      finally{client.release();}
    }};
  return{pool,db};
}
