import { z } from 'zod';
import { RuntimeGateway } from './runtime-gateway';
import { searchProfileSchema,searchSettingsSchema,searchProbeResultSchema } from '../../../packages/contracts/src/search';
export class SearchGateway extends RuntimeGateway {
  settings(owner:string){return this.forward(`/search-settings/${owner}`,searchSettingsSchema);}
  describe(owner:string,id:string){return this.forward(`/search-settings/${owner}/${id}`,searchProfileSchema);}
  save(owner:string,body:unknown){return this.forward(`/search-settings/${owner}`,searchProfileSchema,'POST',body);}
  clear(owner:string){return this.forward(`/search-settings/${owner}`,z.object({cleared:z.boolean()}),'DELETE');}
  probe(body:unknown){return this.forward('/search-probe',searchProbeResultSchema,'POST',body);}
}
