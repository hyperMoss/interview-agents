import 'reflect-metadata';
import { Body, Controller, Delete, Get, Inject, Module, Param, Post, Req, BadRequestException,Patch,UploadedFile,UseInterceptors } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { Request } from 'express';
import { json } from 'express';
import { z } from 'zod';
import { startInterviewSchema, answerSchema,retrySchema } from '../../../packages/contracts/src/index';
import { modelAccessSchema,modelDraftSchema,saveModelSchema } from '../../../packages/contracts/src/models';
import { readApiConfig } from '../../../packages/config/src/index';
import { InterviewService } from './interviews';
import { signedIdentity } from './auth';
import { runtimeCapabilities } from './runtime-capabilities';
import { checkReferenceRuntime } from '../../../packages/factory/src/runtime-check';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { importResume } from './resume';
import { bankCreateSchema,bankUpdateSchema,leetcodeImportSchema,leetcodeBatchSchema } from '../../../packages/contracts/src/bank';
import { searchDraftSchema,searchProbeSchema } from '../../../packages/contracts/src/search';
import { previewPlanSchema,replanSchema } from '../../../packages/contracts/src/planning';
await checkReferenceRuntime();
const config = readApiConfig();
function owner(req: Request) { return z.string().parse(req.headers['x-owner-id']); }
function uuid(value: string) { const result = z.uuid().safeParse(value); if (!result.success) throw new BadRequestException('Invalid interview ID'); return result.data; }
function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) throw new BadRequestException(result.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; '));
  return result.data;
}
@Controller('api/v1')
class InterviewController {
  constructor(@Inject('INTERVIEWS') private readonly service: InterviewService) {}
  @Get('health') async health() { await this.service.database.pool.query('SELECT 1'); return { status: 'ok' }; }
  @Get('capabilities') capabilities() { return { installed: runtimeCapabilities, modelMode: config.MODEL_MODE }; }
  @Get('identity') identity(){return{ready:true};}
  @Get('interviews') list(@Req() req: Request) { return this.service.list(owner(req)); }
  @Post('interviews') create(@Req() req: Request, @Body() body: unknown) { const input=parse(startInterviewSchema,body);return this.service.create(owner(req),input.input,input.modelConnectionId,input.search); }
  @Post('interviews/plan') preview(@Req() req:Request,@Body() body:unknown){return this.service.previewPlan(owner(req),parse(previewPlanSchema,body).options);}
  @Post('interviews/:id/replan') replan(@Req() req:Request,@Param('id') id:string,@Body() body:unknown){return this.service.replan(owner(req),uuid(id),parse(replanSchema,body));}
  @Get('interviews/:id') get(@Req() req: Request, @Param('id') id: string) { return this.service.get(owner(req), uuid(id)); }
  @Post('interviews/:id/answers') answer(@Req() req: Request, @Param('id') id: string, @Body() body: unknown) { return this.service.answer(owner(req), uuid(id), parse(answerSchema, body)); }
  @Post('interviews/:id/cancel') cancel(@Req() req: Request, @Param('id') id: string) { return this.service.cancel(owner(req), uuid(id)); }
  @Post('interviews/:id/retry') retry(@Req() req:Request,@Param('id') id:string,@Body() body:unknown){return this.service.retry(owner(req),uuid(id),parse(retrySchema,body));}
  @Get('models/settings') settings(@Req() req:Request){return this.service.models.settings(owner(req));}
  @Post('models/settings') saveModel(@Req() req:Request,@Body() body:unknown){return this.service.models.save(owner(req),parse(saveModelSchema,body));}
  @Delete('models/settings') clearModel(@Req() req:Request){return this.service.models.clear(owner(req));}
  @Post('models/list') listModels(@Body() body:unknown){return this.service.models.list(parse(modelAccessSchema,body));}
  @Post('models/probe') probeModel(@Body() body:unknown){return this.service.models.probe(parse(modelDraftSchema,body));}
  @Get('search/settings') searchSettings(@Req() req:Request){return this.service.search.settings(owner(req));}
  @Post('search/settings') saveSearch(@Req() req:Request,@Body() body:unknown){return this.service.search.save(owner(req),parse(searchDraftSchema,body));}
  @Delete('search/settings') clearSearch(@Req() req:Request){return this.service.search.clear(owner(req));}
  @Post('search/probe') probeSearch(@Body() body:unknown){return this.service.search.probe(parse(searchProbeSchema,body));}
  @Post('resumes/import')
  @UseInterceptors(FileInterceptor('file',{storage:memoryStorage(),limits:{fileSize:5*1024*1024,files:1}}))
  uploadResume(@UploadedFile() file:unknown){return importResume(file);}
  @Get('question-bank') listBank(@Req() req:Request){return this.service.bank.list(owner(req));}
  @Post('question-bank') createQuestion(@Req() req:Request,@Body() body:unknown){const input=parse(bankCreateSchema,body);return this.service.bank.create(owner(req),input.requestId,input.draft);}
  @Patch('question-bank/:id') updateQuestion(@Req() req:Request,@Param('id') id:string,@Body() body:unknown){const input=parse(bankUpdateSchema,body);return this.service.bank.update(owner(req),uuid(id),input.revision,input.draft);}
  @Delete('question-bank/:id') deleteQuestion(@Req() req:Request,@Param('id') id:string){return this.service.bank.remove(owner(req),uuid(id));}
  @Post('question-bank/import/leetcode') importLeetCode(@Req() req:Request,@Body() body:unknown){return this.service.bank.importLeetCode(owner(req),parse(leetcodeImportSchema,body));}
  @Post('question-bank/import/json') importBankJson(@Req() req:Request,@Body() body:unknown){return this.service.bank.importBatch(owner(req),parse(leetcodeBatchSchema,body));}
  @Delete('interviews/:id') remove(@Req() req: Request, @Param('id') id: string) { return this.service.remove(owner(req), uuid(id)); }
}
@Module({ controllers: [InterviewController], providers: [{ provide: 'INTERVIEWS', useFactory: () => new InterviewService(config) }] })
class ApiModule {}
const app = await NestFactory.create(ApiModule, { bodyParser: false });
app.use(signedIdentity(config));
app.use('/api/v1/question-bank/import/json',json({limit:'8mb'}));
app.use(json({ limit: '128kb' }));
app.enableShutdownHooks();
await app.listen(config.API_PORT, '0.0.0.0');
