import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { BadRequestException,UnprocessableEntityException,RequestTimeoutException } from '@nestjs/common';
import { z } from 'zod';

export const resumeResultSchema=z.strictObject({filename:z.string(),text:z.string().max(64000),warnings:z.array(z.string())});
const fileSchema=z.object({originalname:z.string().min(1).max(200),buffer:z.instanceof(Buffer),size:z.number().int().min(1).max(5*1024*1024)});
export async function importResume(raw:unknown){
  const parsed=fileSchema.safeParse(raw);if(!parsed.success)throw new BadRequestException('请选择一个不超过 5 MB 的简历文件。');
  const file=parsed.data;
  if(!/\.(pdf|docx|txt|md)$/i.test(file.originalname))throw new BadRequestException('支持 PDF、DOCX、TXT 或 Markdown 简历。旧版 DOC 请转换为 DOCX。');
  return new Promise<z.infer<typeof resumeResultSchema>>((resolve,reject)=>{
    const child=spawn(process.execPath,['--max-old-space-size=128',fileURLToPath(new URL('./resume-worker.mjs',import.meta.url))],{env:{PATH:process.env.PATH??''},stdio:['pipe','pipe','ignore']});
    const timer=setTimeout(()=>{child.kill('SIGKILL');reject(new RequestTimeoutException('文件解析超时，请缩小文件或粘贴简历文本。'));},10000);
    child.stdout.setEncoding('utf8');let output='';child.stdout.on('data',chunk=>{output+=String(chunk);if(output.length>300000)child.kill('SIGKILL');});
    child.on('error',()=>{clearTimeout(timer);reject(new UnprocessableEntityException('简历解析服务暂时不可用。'));});
    child.on('close',code=>{clearTimeout(timer);if(code!==0){reject(new UnprocessableEntityException('文件无法解析。扫描 PDF 需要先做 OCR，加密文件请解除密码。'));return;}
      try{resolve(resumeResultSchema.parse(JSON.parse(output)));}catch{reject(new UnprocessableEntityException('无法提取有效简历文本。'));}
    });
    child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify({filename:file.originalname,bytes:file.buffer.toString('base64')}));
  });
}
