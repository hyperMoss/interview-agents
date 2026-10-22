import { preparationResultSchema, type preparationRequestSchema } from '../../../packages/contracts/src/preparation';
import { RuntimeGateway } from './runtime-gateway';
import { validatePreparation } from '../../../packages/interview/src/preparation';
import type { z } from 'zod';

export class PreparationGateway extends RuntimeGateway {
  async generate(ownerId: string, request: z.infer<typeof preparationRequestSchema>) {
    const result = await this.forward('/preparations/generate', preparationResultSchema, 'POST', { ...request, ownerId }, 60000);
    validatePreparation(request.input, { requirements: result.requirements, questions: result.questions });
    return result;
  }
}
