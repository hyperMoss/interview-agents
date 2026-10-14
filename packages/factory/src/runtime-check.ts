import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';
import { runtimeCapabilities } from '../../../apps/api/src/runtime-capabilities';
import { resolveSpec } from './resolver';
export async function checkReferenceRuntime(){
  const plan=resolveSpec(parse(await readFile(new URL('../../../app.spec.yaml',import.meta.url),'utf8')));
  const selected=plan.capabilities.map(capability=>capability.id).sort();const implemented=[...runtimeCapabilities].sort();
  if(JSON.stringify(selected)!==JSON.stringify(implemented))throw new Error('RUNTIME_SPEC_MISMATCH: this reference application implements the interview recipe; implement changed capabilities before building or starting it. Document-only plans do not enable runtime features.');
}
