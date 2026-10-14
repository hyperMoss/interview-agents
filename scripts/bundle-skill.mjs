import { build } from 'esbuild';
await build({ entryPoints: ['packages/factory/src/cli.ts'], outfile: 'skills/software-factory/scripts/factory.mjs', bundle: true, platform: 'node', format: 'esm', target: 'node22', minify: true, banner: { js: '#!/usr/bin/env node\nimport { createRequire } from "node:module"; const require = createRequire(import.meta.url);' } });
