import { parseArgs } from 'node:util';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { parse, stringify } from 'yaml';
import { z } from 'zod';
import { resolveSpec } from './resolver';
import { blueprints } from './catalog';
import { compile, writeGenerated, readOptional, lockSchema } from './compiler';
import { activeLearning, recordEvidence, proposeLearning, promoteLearning, rollbackLearning } from './learning';

const help=`Software Factory v0.1\n
init --blueprint interview-practice --id my-app --output ./my-app
plan|resolve --spec app.spec.yaml
docs|generate|diff --spec app.spec.yaml --output . [--store PATH] [--learning-version N]
validate --spec app.spec.yaml [--target production]
context --output . --task implement-interview.practice
learn-record --file evidence.json --project . [--store PATH]
learn-propose --file proposal.json [--store PATH]
learn-promote --id lesson-id --reviewer NAME --file replay.json [--store PATH]
learn-rollback --version N --reviewer NAME [--store PATH]
learn-status [--store PATH]

generate currently compiles design/context/config artifacts. Business code generation is guided by the skill, not an autonomous code generator.
Learning defaults to ~/.codex/software-factory; existing projects pin their learning version unless --learning-version explicitly selects another.
`;
async function main() {
  const {positionals,values}=parseArgs({allowPositionals:true,options:{spec:{type:'string'},output:{type:'string'},blueprint:{type:'string'},id:{type:'string'},
    store:{type:'string'},file:{type:'string'},project:{type:'string'},reviewer:{type:'string'},version:{type:'string'},'learning-version':{type:'string'},target:{type:'string'},task:{type:'string'},help:{type:'boolean'}}});
  const command=positionals[0];if(!command||values.help){process.stdout.write(help);return;}
  const output=resolve(values.output??'.');const specPath=resolve(values.spec??'app.spec.yaml');
  const store=resolve(values.store??resolve(process.env.CODEX_HOME??resolve(homedir(),'.codex'),'software-factory'));
  const required=(value:string|undefined,name:string)=>{if(!value)throw new Error(`Missing --${name}`);return value;};
  if(command==='init'){
    const blueprint=z.custom<keyof typeof blueprints>(value=>typeof value==='string'&&Object.hasOwn(blueprints,value)).parse(values.blueprint??'interview-practice');
    const input={schema_version:'1',project:{id:required(values.id,'id'),display_name:values.id},blueprint,
      business:{summary:'待填写具体用户、业务目标与使用场景。',roles:['owner'],requirements:[{id:'REQ-001',statement:'待填写可验证的业务需求。',acceptance:'待填写可观察的验收结果。',capabilities:[blueprints[blueprint][0]]}],out_of_scope:[]},capabilities:{},providers:{},options:{},policy:{}};
    resolveSpec(input);await mkdir(output,{recursive:true});await writeFile(resolve(output,'app.spec.yaml'),stringify(input),{flag:'wx'});
    process.stdout.write(`Created ${resolve(output,'app.spec.yaml')}; replace intake placeholders before declaring requirements complete.\n`);return;
  }
  if(command==='learn-record'){const record=await recordEvidence(store,resolve(values.project??'.'),resolve(required(values.file,'file')));print({recordId:record.recordId,projectId:record.projectId});return;}
  if(command==='learn-propose'){print(await proposeLearning(store,JSON.parse(await readFile(resolve(required(values.file,'file')),'utf8'))));return;}
  if(command==='learn-promote'){
    const replays=z.array(z.strictObject({projectDir:z.string(),manifestPath:z.string()})).min(2).parse(JSON.parse(await readFile(resolve(required(values.file,'file')),'utf8')));
    print(await promoteLearning(store,required(values.id,'id'),required(values.reviewer,'reviewer'),replays));return;
  }
  if(command==='learn-rollback'){print(await rollbackLearning(store,z.coerce.number().int().nonnegative().parse(required(values.version,'version')),required(values.reviewer,'reviewer')));return;}
  if(command==='learn-status'){print(await activeLearning(store));return;}
  if(command==='context'){
    const index=z.object({global:z.array(z.string()),tasks:z.record(z.string(),z.array(z.string()))}).parse(JSON.parse(await readFile(resolve(output,'docs/context/index.json'),'utf8')));
    const task=required(values.task,'task');const paths=index.tasks[task];if(!paths)throw new Error('Task is not installed');
    for(const path of [...index.global,...paths])await readFile(resolve(output,path),'utf8');
    print([...new Set([...index.global,...paths])]);return;
  }
  const plan=resolveSpec(parse(await readFile(specPath,'utf8')));
  if(command==='plan'||command==='resolve'){print(plan);return;}
  if(command==='validate'){
    if(values.target&&values.target!=='production'&&values.target!=='development')throw new Error('Unknown target');
    if(values.target==='production'&&plan.capabilities.some(c=>c.maturity!=='supported'))throw new Error('Production cannot enable planned capabilities');
    print({valid:true,capabilities:plan.capabilities.length,scope:values.target==='production'?'capability maturity gate only; runtime production config, paid-provider acceptance and ops gates remain required':'schema and dependency graph'});return;
  }
  if(command==='docs'||command==='generate'||command==='diff'){
    const previous=await readOptional(resolve(output,'factory.lock.json'));
    const pinned=values['learning-version']===undefined?(previous?lockSchema.parse(JSON.parse(previous)).learningVersion:undefined):z.coerce.number().int().nonnegative().parse(values['learning-version']);
    const learning=await activeLearning(store,pinned);print(await writeGenerated(output,compile(plan,learning.rules,learning.version),command==='diff'));return;
  }
  throw new Error(`Unknown command ${command}`);
}
function print(value:unknown){process.stdout.write(JSON.stringify(value,null,2)+'\n');}
main().catch(error=>{process.stderr.write(`${error instanceof Error?error.message:'FACTORY_FAILED'}\n`);process.exitCode=1;});
