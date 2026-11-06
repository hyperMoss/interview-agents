import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import ts from 'typescript';
const root=process.argv[2]??process.cwd();
const db=new DatabaseSync(':memory:');db.exec(fs.readFileSync(path.join(root,'infra/sqlite/001-init.sql'),'utf8'));
const files=p=>fs.readdirSync(p,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(p,e.name)):[path.join(p,e.name)]);
let count=0;let failed=false;
for(const f of ['apps','packages/career'].flatMap(p=>files(path.join(root,p))).filter(f=>f.endsWith('.ts'))){const ast=ts.createSourceFile(f,fs.readFileSync(f,'utf8'),ts.ScriptTarget.Latest,true);
function visit(n){if(ts.isCallExpression(n)&&ts.isPropertyAccessExpression(n.expression)&&n.expression.name.text==='query'){
 const a=n.arguments[0];if(a&&(ts.isStringLiteral(a)||ts.isNoSubstitutionTemplateLiteral(a))&&/^\s*(SELECT|INSERT|UPDATE|DELETE)\b/i.test(a.text)){
  try{db.prepare('EXPLAIN '+a.text);count++;}catch(e){failed=true;const line=ast.getLineAndCharacterOfPosition(a.getStart(ast)).line+1;console.error(`${path.relative(root,f)}:${line}: ${e.message}`);}
 }
}ts.forEachChild(n,visit);}visit(ast);}
db.close();console.log(`SQLite syntax: ${count} literal queries prepared; dynamic templates require behavioral tests.`);process.exitCode=failed?1:0;
