import {z} from 'zod';
import {preparationInputSchema,preparationRequestSchema,preparationResultSchema} from './preparation';
export const preparationGenerateCommandSchema=preparationRequestSchema.extend({requestId:z.uuid().optional()});
export const preparationHistoryOutcomeSchema=z.discriminatedUnion('status',[
  z.strictObject({status:z.literal('generating')}),
  z.strictObject({status:z.literal('ready'),result:preparationResultSchema}),
  z.strictObject({status:z.literal('failed'),code:z.string().min(1).max(100),message:z.string().min(1).max(600),httpStatus:z.number().int().min(400).max(599).default(502)}),
]);
export const preparationHistorySchema=z.strictObject({
  id:z.uuid(),parentId:z.uuid().nullable(),input:preparationInputSchema,modelConnectionId:z.uuid().nullable(),
  createdAt:z.iso.datetime(),updatedAt:z.iso.datetime(),outcome:preparationHistoryOutcomeSchema,
});
export type PreparationHistory=z.infer<typeof preparationHistorySchema>;
export const preparationHistorySummarySchema=z.strictObject({id:z.uuid(),parentId:z.uuid().nullable(),role:z.string(),questionCount:z.number().int(),createdAt:z.iso.datetime(),status:z.enum(['generating','ready','failed'])});
export const preparationHistoryQuerySchema=z.object({limit:z.coerce.number().int().min(1).max(50).default(20),before:z.uuid().optional()});
export const preparationHistoryPageSchema=z.strictObject({items:z.array(preparationHistorySummarySchema),nextBefore:z.uuid().nullable()});
export const preparationHistoryRetrySchema=z.strictObject({requestId:z.uuid(),modelConnectionId:z.uuid().nullable()});
