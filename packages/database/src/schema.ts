import { sqliteTable, text, integer, customType } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
const timestamp=customType<{data:Date;driverData:string}>({dataType:()=> 'text',toDriver:value=>value.toISOString().replace(/(\.\d{3})Z$/,'$1000Z'),fromDriver:value=>new Date(value)});
const uuid=text;
const jsonb=(name:string)=>text(name,{mode:'json'});
import type { RuntimeRequest, Session } from '../../contracts/src/index';
import type { BankQuestion } from '../../contracts/src/bank';

export const interviews = sqliteTable('app_interviews', {
  id: uuid('id').primaryKey(), owner: text('owner').notNull(), state: jsonb('state').$type<Session>().notNull(),
  createdAt: timestamp('created_at').default(sql`(strftime('%Y-%m-%dT%H:%M:%f000Z','now'))`).notNull(),
});
export const jobs = sqliteTable('app_jobs', {
  id: uuid('id').primaryKey(), sessionId: uuid('session_id').notNull().references(() => interviews.id, { onDelete: 'cascade' }),
  owner: text('owner').notNull(), revision: integer('revision').notNull(), payload: jsonb('payload').$type<RuntimeRequest>().notNull(),
  status: text('status').notNull(), attempts: integer('attempts').notNull().default(0), leaseUntil: timestamp('lease_until'),
  requestHash: text('request_hash').notNull(), createdAt: timestamp('created_at').default(sql`(strftime('%Y-%m-%dT%H:%M:%f000Z','now'))`).notNull(),
});
export const deletions = sqliteTable('app_deletions', {
  jobId: uuid('job_id').primaryKey(), createdAt: timestamp('created_at').default(sql`(strftime('%Y-%m-%dT%H:%M:%f000Z','now'))`).notNull(),
});
export const interviewMaterials=sqliteTable('app_interview_materials',{sessionId:uuid('session_id').primaryKey().references(()=>interviews.id,{onDelete:'cascade'}),questions:jsonb('questions').$type<BankQuestion[]>().notNull()});
export const interviewCommands=sqliteTable('app_interview_commands',{requestId:uuid('request_id').primaryKey(),sessionId:uuid('session_id').notNull().references(()=>interviews.id,{onDelete:'cascade'}),owner:text('owner').notNull(),requestHash:text('request_hash').notNull(),acceptedRevision:integer('accepted_revision').notNull(),createdAt:timestamp('created_at').default(sql`(strftime('%Y-%m-%dT%H:%M:%f000Z','now'))`).notNull()});
