import { describe,it,expect } from 'vitest';
import { importResume } from '../apps/api/src/resume';
import { readFile } from 'node:fs/promises';
const text='真实测试资料。负责业务接口、数据库建模和任务队列，使用测试与指标核验改进。';
describe('local resume import',()=>{
  it('imports a UTF-8 resume as editable text without sending it to a provider',async()=>{const bytes=Buffer.from(text);expect(await importResume({originalname:'resume.txt',buffer:bytes,size:bytes.length})).toEqual({filename:'resume.txt',text,warnings:[]});});
  it('extracts actual PDF and DOCX files locally',async()=>{
    for(const filename of ['resume.pdf','resume.docx']){const bytes=await readFile(new URL(`files/${filename}`,import.meta.url));const result=await importResume({originalname:filename,buffer:bytes,size:bytes.length});expect(result.text).toContain(filename.endsWith('pdf')?'Built APIs':'负责业务接口');}
  });
  it('rejects oversized, unsupported, mislabelled and empty documents',async()=>{
    await expect(importResume({originalname:'resume.txt',buffer:Buffer.alloc(1),size:6*1024*1024})).rejects.toThrow('5 MB');
    const bytes=Buffer.from(text);
    await expect(importResume({originalname:'resume.exe',buffer:bytes,size:bytes.length})).rejects.toThrow('支持');
    await expect(importResume({originalname:'resume.pdf',buffer:bytes,size:bytes.length})).rejects.toThrow('解析');
    await expect(importResume({originalname:'empty.txt',buffer:Buffer.from('x'),size:1})).rejects.toThrow('解析');
  });
});
