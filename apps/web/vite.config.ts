import { defineConfig,loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import {canonicalDevOrigin} from './dev-origin';
export default defineConfig(({mode})=>{
  const env=loadEnv(mode,fileURLToPath(new URL('../../',import.meta.url)),['WEB_ORIGIN','API_PORT']);
  return{
    root:fileURLToPath(new URL('.',import.meta.url)),plugins:[canonicalDevOrigin(env.WEB_ORIGIN??'http://localhost:5173'),react()],
    server:{host:'127.0.0.1',port:5173,proxy:{'/api':`http://127.0.0.1:${env.API_PORT??'3000'}`}},
    build:{outDir:'../../dist/web',emptyOutDir:true},
  };
});
