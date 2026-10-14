import { z } from 'zod';
import { catalog, blueprints, providerOptions, type CapabilityId } from './catalog';
export const capabilitySchema = z.custom<CapabilityId>(value => typeof value === 'string' && Object.hasOwn(catalog, value), 'Unknown capability');
const blueprintSchema = z.custom<keyof typeof blueprints>(value => typeof value === 'string' && Object.hasOwn(blueprints, value), 'Unknown blueprint');
export const specSchema = z.strictObject({
  schema_version: z.literal('1'),
  project: z.strictObject({ id: z.string().regex(/^[a-z][a-z0-9-]{1,62}$/), display_name: z.string().min(1).max(100) }),
  blueprint: blueprintSchema,
  business: z.strictObject({ summary: z.string().min(10).max(1000), roles: z.array(z.string()).min(1),
    requirements: z.array(z.strictObject({ id: z.string().regex(/^REQ-[A-Z0-9-]+$/), statement: z.string().min(5), acceptance: z.string().min(5), capabilities: z.array(capabilitySchema).min(1) })).min(1),
    out_of_scope: z.array(z.string()).default([]) }),
  capabilities: z.partialRecord(capabilitySchema, z.union([z.boolean(),z.literal('auto')])).default({}),
  providers: z.partialRecord(capabilitySchema, z.string()).default({}),
  options: z.strictObject({ rag_mode: z.enum(['lexical','semantic','hybrid']).default('lexical'),
    rag_sources: z.array(z.enum(['text','uploaded_documents','web_pages'])).min(1).default(['text']),
    asr_mode: z.enum(['file','realtime']).default('realtime'), persist_audio: z.boolean().default(false),
    search_mode:z.enum(['deployment','byok']).default('deployment'),
    require_email_verification: z.boolean().default(false) }).default({ rag_mode: 'lexical', rag_sources: ['text'], asr_mode: 'realtime', persist_audio: false, require_email_verification: false,search_mode:'deployment' }),
  policy: z.strictObject({ allow_cloud_processing: z.boolean().default(true), forbidden_capabilities: z.array(capabilitySchema).default([]) }).default({allow_cloud_processing:true,forbidden_capabilities:[]}),
});
export type Spec = z.infer<typeof specSchema>;
export function resolveSpec(raw: unknown) {
  const spec = specSchema.parse(raw);
  if(/\bsk-[A-Za-z0-9_-]{12,}|-----BEGIN .*PRIVATE KEY|(?:api[_-]?key|secret|password)\s*[=:]\s*["']?[^\s"']{8,}/i.test(JSON.stringify(spec)))throw new Error('SPEC_CONTAINS_SECRET: use environment secret references, not credential values');
  const requirements = new Set<string>();
  for (const req of spec.business.requirements) { if (requirements.has(req.id)) throw new Error(`Duplicate requirement ${req.id}`); requirements.add(req.id); }
  const enabled = new Map<CapabilityId, Set<string>>();
  const visiting = new Set<CapabilityId>();
  function add(id: CapabilityId, reason: string) {
    if (spec.capabilities[id] === false || spec.policy.forbidden_capabilities.includes(id)) throw new Error(`Capability conflict: ${reason} requires explicitly forbidden ${id}`);
    const prior = enabled.get(id);
    if (prior) { prior.add(reason); if (visiting.has(id)) throw new Error(`Dependency cycle at ${id}`); return; }
    enabled.set(id, new Set([reason])); visiting.add(id);
    const deps: CapabilityId[] = catalog[id].dependencies.map(dep => capabilitySchema.parse(dep));
    if (id === 'rag.knowledge') {
      if (spec.options.rag_mode !== 'semantic') deps.push('retrieval.lexical');
      if (spec.options.rag_mode !== 'lexical') deps.push('retrieval.vector');
      if (spec.options.rag_sources.includes('uploaded_documents')) deps.push('files.manage','documents.parse');
      if (spec.options.rag_sources.includes('web_pages')) deps.push('web.extract');
    }
    if (id === 'speech.asr' && spec.options.asr_mode === 'file') deps.push('files.manage','jobs.async');
    if ((id === 'speech.tts' || id === 'speech.asr') && spec.options.persist_audio) deps.push('files.object-storage');
    for (const dep of deps) add(dep, id);
    visiting.delete(id);
  }
  add('core.platform','factory baseline');
  for (const id of blueprints[spec.blueprint]) if (spec.capabilities[id] !== false) add(id, `blueprint:${spec.blueprint}`);
  for (const id of Object.keys(spec.capabilities).sort().map(value => capabilitySchema.parse(value))) if (spec.capabilities[id] === true) add(id,'explicit');
  if (spec.options.require_email_verification) add('mail.delivery','email verification policy');
  for (const req of spec.business.requirements) for (const id of req.capabilities) {
    if (!enabled.has(id)) throw new Error(`${req.id} refers to unselected capability ${id}`);
    enabled.get(id)?.add(req.id);
  }
  const capabilities = [...enabled.entries()].sort(([a],[b]) => a.localeCompare(b)).map(([id,reasons]) => ({ id, version: '0.1.0', maturity: catalog[id].maturity, reasons: [...reasons].sort() }));
  const providers = capabilities.flatMap(({ id }) => {
    const choices = providerOptions[id]; if (!choices) return [];
    const selected = spec.providers[id] ?? choices[0];
    if (!selected || !choices.includes(selected)) throw new Error(`Provider ${selected} does not implement ${id}`);
    if (selected.endsWith('-cloud') && !spec.policy.allow_cloud_processing) throw new Error('Cloud parsing forbidden by policy');
    return [{ capability: id, provider: selected }];
  });
  for (const id of Object.keys(spec.providers).map(value => capabilitySchema.parse(value))) {
    if (!providerOptions[id]) throw new Error(`Capability ${id} has no provider selection`);
    if (!providerOptions[id]?.includes(spec.providers[id] ?? '')) throw new Error(`Unknown provider for ${id}`);
  }
  const services = new Set(capabilities.flatMap(({id}) => catalog[id].services));
  if (providers.some(p => p.provider === 'elasticsearch')) services.add('elasticsearch');
  const env = new Map<string, Set<string>>();
  for (const { id } of capabilities) for (const [service, keys] of Object.entries(catalog[id].env)) {
    const set = env.get(service) ?? new Set(); keys.forEach(key => set.add(key)); env.set(service,set);
  }
  const webProviders=providers.filter(selected=>selected.capability==='web.search'||selected.capability==='web.extract');
  if(webProviders.length){
    const keys=env.get('api')??new Set<string>();keys.delete('TAVILY_API_KEY');keys.delete('FIRECRAWL_API_KEY');
    for(const selected of webProviders)if(selected.capability!=='web.search'||spec.options.search_mode!=='byok')keys.add(selected.provider==='tavily'?'TAVILY_API_KEY':'FIRECRAWL_API_KEY');env.set('api',keys);
    if(spec.options.search_mode==='byok'&&webProviders.some(p=>p.capability==='web.search')){const agent=env.get('agent')??new Set<string>();for(const key of ['SEARCH_ACCESS','SEARCH_ALLOWED_HOSTS','ALLOW_LOCAL_SEARCH'])agent.add(key);env.set('agent',agent);}
  }
  return { schemaVersion: 1, factoryVersion: '0.1.0', spec, capabilities, providers, services: [...services].sort(),
    env: Object.fromEntries([...env.entries()].sort(([a],[b]) => a.localeCompare(b)).map(([service,keys]) => [service,[...keys].sort()])) };
}
export type Plan = ReturnType<typeof resolveSpec>;
