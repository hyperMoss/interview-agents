import { checkReferenceRuntime } from '../packages/factory/src/runtime-check';
await checkReferenceRuntime();
process.stdout.write('Runtime capability registry matches app.spec.yaml.\n');
