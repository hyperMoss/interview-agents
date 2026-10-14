import { pgSchema, uuid, text, timestamp, jsonb, integer } from 'drizzle-orm/pg-core';
import type { RuntimeRequest, Session } from '../../contracts/src/index';
import type { BankQuestion } from '../../contracts/src/bank';
const app = pgSchema('app');
export const interviews = app.table('interviews', {
  id: uuid('id').primaryKey(), owner: text('owner').notNull(), state: jsonb('state').$type<Session>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
export const jobs = app.table('jobs', {
  id: uuid('id').primaryKey(), sessionId: uuid('session_id').notNull().references(() => interviews.id, { onDelete: 'cascade' }),
  owner: text('owner').notNull(), revision: integer('revision').notNull(), payload: jsonb('payload').$type<RuntimeRequest>().notNull(),
  status: text('status').notNull(), attempts: integer('attempts').notNull().default(0), leaseUntil: timestamp('lease_until', { withTimezone: true }),
  requestHash: text('request_hash').notNull(), createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
export const deletions = app.table('deletions', {
  jobId: uuid('job_id').primaryKey(), createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
export const interviewMaterials=app.table('interview_materials',{sessionId:uuid('session_id').primaryKey().references(()=>interviews.id,{onDelete:'cascade'}),questions:jsonb('questions').$type<BankQuestion[]>().notNull()});
export const interviewCommands=app.table('interview_commands',{requestId:uuid('request_id').primaryKey(),sessionId:uuid('session_id').notNull().references(()=>interviews.id,{onDelete:'cascade'}),owner:text('owner').notNull(),requestHash:text('request_hash').notNull(),acceptedRevision:integer('accepted_revision').notNull(),createdAt:timestamp('created_at',{withTimezone:true}).defaultNow().notNull()});
