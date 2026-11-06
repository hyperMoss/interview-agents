import { readFile } from 'node:fs/promises';
import { BadRequestException, Body, ConflictException, Controller, Delete, Get, Inject, NotFoundException, Param, Patch, Post, Query, Req, Res, ServiceUnavailableException, UseFilters } from '@nestjs/common';
import type { Request, Response } from 'express';
import { chromium } from 'playwright';
import { z } from 'zod';
import type { ApiConfig } from '../../../packages/config/src/index';
import { openDatabase } from '../../../packages/database/src/client';
import { resumeDraftInputSchema, resumeDraftSchema, resumeDraftSummarySchema, resumeDraftUpdateSchema } from '../../../packages/contracts/src/resume-document';
import { resumeHtml } from '../../../packages/resume/src/render';
import { CareerErrorFilter } from './errors';

export const RESUME_DRAFTS = 'RESUME_DRAFTS';
const createSchema = resumeDraftInputSchema.extend({ id: z.uuid() });
const revisionSchema = z.strictObject({ revision: z.number().int().positive() });
const rowSchema = z.object({ id: z.uuid(), label: z.string(), revision: z.number(), document_json: z.string(), created_at: z.date(), updated_at: z.date() });
export class ResumeDraftService {
  readonly pool;
  constructor(config: Pick<ApiConfig, 'DATABASE_URL'>) { this.pool = openDatabase(config.DATABASE_URL).pool; }
  async list(owner: string) {
    const result = await this.pool.query('SELECT id,label,revision,created_at,updated_at FROM app_resume_drafts WHERE owner=$1 ORDER BY updated_at DESC,id DESC', [owner]);
    return result.rows.map(raw => {
      const row = rowSchema.omit({ document_json: true }).parse(raw);
      return resumeDraftSummarySchema.parse({ id: row.id, label: row.label, revision: row.revision, createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString() });
    });
  }
  async get(owner: string, id: string) {
    const result = await this.pool.query('SELECT * FROM app_resume_drafts WHERE owner=$1 AND id=$2', [owner, id]);
    if (!result.rows[0]) throw new NotFoundException('简历副本不存在。');
    const row = rowSchema.parse(result.rows[0]);
    return resumeDraftSchema.parse({ id: row.id, label: row.label, revision: row.revision, document: JSON.parse(row.document_json), createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString() });
  }
  async create(owner: string, input: z.infer<typeof createSchema>) {
    const result = await this.pool.query('INSERT INTO app_resume_drafts(id,owner,label,document_json) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO NOTHING RETURNING id', [input.id, owner, input.label, JSON.stringify(input.document)]);
    if (!result.rowCount) {
      const existing = await this.get(owner, input.id);
      if (existing.label !== input.label || JSON.stringify(existing.document) !== JSON.stringify(input.document)) throw new ConflictException('该创建请求已经保存了其他内容，请重新新建副本。');
      return existing;
    }
    return this.get(owner, input.id);
  }
  async update(owner: string, id: string, input: z.infer<typeof resumeDraftUpdateSchema>) {
    const result = await this.pool.query("UPDATE app_resume_drafts SET label=$1,document_json=$2,revision=revision+1,updated_at=(strftime('%Y-%m-%dT%H:%M:%f000Z','now')) WHERE owner=$3 AND id=$4 AND revision=$5 RETURNING id", [input.label, JSON.stringify(input.document), owner, id, input.revision]);
    if (!result.rowCount) { await this.get(owner, id); throw new ConflictException('另一个页面已修改这个副本。请保留当前 JSON，重新读取后合并，或另存为副本。'); }
    return this.get(owner, id);
  }
  async remove(owner: string, id: string, revision: number) {
    const result = await this.pool.query('DELETE FROM app_resume_drafts WHERE owner=$1 AND id=$2 AND revision=$3 RETURNING id', [owner, id, revision]);
    if (!result.rowCount) { await this.get(owner, id); throw new ConflictException('副本已更新，请重新读取后确认删除。'); }
    return { deleted: true };
  }
  async pdf(owner: string, id: string, revision: number) {
    const draft = await this.get(owner, id);
    if (draft.revision !== revision) throw new ConflictException('副本已更新，请重新读取再导出。');
    const css = await readFile(new URL('../../../packages/resume/src/resume.css', import.meta.url), 'utf8');
    const browser = await chromium.launch({ headless: true }).catch(() => chromium.launch({ channel: 'chrome', headless: true })).catch(() => { throw new ServiceUnavailableException('无法启动本机 PDF 引擎。请安装 Chrome，或运行 pnpm exec playwright install chromium 后重试；也可导出 HTML 后用浏览器打印。'); });
    const deadline = setTimeout(() => { void browser.close(); }, 30000);
    try {
      const context = await browser.newContext({ offline: true, serviceWorkers: 'block' });
      await context.route('**/*', route => route.abort());
      const page = await context.newPage();
      await page.setContent(resumeHtml(draft.document, css), { timeout: 15000 });
      await page.evaluate(() => document.fonts.ready);
      const bytes = await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true });
      return { bytes, filename: `${draft.label}.pdf`, revision: draft.revision };
    } finally { clearTimeout(deadline); await browser.close(); }
  }
  async close() { await this.pool.end(); }
}
function owner(req: Request) { return z.uuid().parse(req.headers['x-owner-id']); }
function idParam(id: string) {
  const parsed = z.uuid().safeParse(id);
  if (!parsed.success) throw new BadRequestException('无效的简历副本编号。');
  return parsed.data;
}
@Controller('api/v1/resume-drafts')
@UseFilters(new CareerErrorFilter())
export class ResumeDraftsController {
  constructor(@Inject(RESUME_DRAFTS) private readonly service: ResumeDraftService) {}
  @Get() list(@Req() req: Request) { return this.service.list(owner(req)); }
  @Post() create(@Req() req: Request, @Body() body: unknown) { return this.service.create(owner(req), createSchema.parse(body)); }
  @Get(':id') get(@Req() req: Request, @Param('id') id: string) { return this.service.get(owner(req), idParam(id)); }
  @Patch(':id') update(@Req() req: Request, @Param('id') id: string, @Body() body: unknown) { return this.service.update(owner(req), idParam(id), resumeDraftUpdateSchema.parse(body)); }
  @Delete(':id') remove(@Req() req: Request, @Param('id') id: string, @Body() body: unknown) { return this.service.remove(owner(req), idParam(id), revisionSchema.parse(body).revision); }
  @Get(':id/pdf') async pdf(@Req() req: Request, @Param('id') id: string, @Query('revision') revision: string, @Res() res: Response) {
    const file = await this.service.pdf(owner(req), idParam(id), z.coerce.number().int().positive().parse(revision));
    res.setHeader('content-type', 'application/pdf');
    res.setHeader('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}`);
    res.setHeader('cache-control', 'no-store');
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('x-resume-revision', String(file.revision));
    res.end(file.bytes);
  }
}
