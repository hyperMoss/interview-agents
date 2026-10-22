import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseOfficialHot100 } from '../packages/interview/src/hot100-source';
import { hot100SourceUrl } from '../packages/contracts/src/hot100';

const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--html' || !args[1]) throw new Error('使用 pnpm algorithm:update --html 官方学习计划的HTML文件。');
const html = await readFile(args[1], 'utf8');
const snapshot = parseOfficialHot100(html, new Date().toISOString().slice(0, 10));
const directory = new URL('../packages/interview/data/', import.meta.url);
await mkdir(directory, { recursive: true });
const destination = fileURLToPath(new URL('hot100.json', directory));
const temporary = `${destination}.${process.pid}.tmp`;
await writeFile(temporary, `${JSON.stringify(snapshot, null, 2)}\n`);
await rename(temporary, destination);
process.stdout.write(`已保存 ${snapshot.questions.length} 题、${new Set(snapshot.questions.map(q => q.group)).size} 个专题。来源 ${hot100SourceUrl}\n`);
