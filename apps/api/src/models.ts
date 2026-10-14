import { z } from 'zod';
import { modelSettingsSchema,modelProfileSchema,modelListSchema,modelProbeSchema } from '../../../packages/contracts/src/models';
import { RuntimeGateway } from './runtime-gateway';
export class ModelGateway extends RuntimeGateway {
  settings(owner:string){return this.forward(`/models/${owner}`,modelSettingsSchema);}
  describe(owner:string,id:string){return this.forward(`/models/${owner}/${id}`,modelProfileSchema);}
  save(owner:string,body:unknown){return this.forward(`/models/${owner}`,modelProfileSchema,'POST',body);}
  clear(owner:string){return this.forward(`/models/${owner}`,z.object({cleared:z.boolean()}),'DELETE');}
  list(body:unknown){return this.forward('/model-list',modelListSchema,'POST',body);}
  probe(body:unknown){return this.forward('/model-probe',modelProbeSchema,'POST',body);}
}
