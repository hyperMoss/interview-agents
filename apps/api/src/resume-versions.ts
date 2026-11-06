import { createHash } from 'node:crypto';
import { z } from 'zod';
import { BadRequestException, ConflictException, Controller, Delete, Get, Inject, Injectable, NotFoundException, Param, Post, Req, Res, UploadedFile, UseFilters, UseInterceptors, Body } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Request, Response } from 'express';
import type { Pool } from "../../../packages/database/src/sqlite";
import { CareerStore, type ResumeRow } from '../../../packages/career/src/store';
import { ResumeFileStore, careerDataDir } from '../../../packages/career/src/storage';
import { digest, normalizeSourceText, textSha256 } from '../../../packages/career/src/domain';
import { resumeDeleteSchema, resumeUploadSchema, resumeVersionSaveSchema, type ResumeVersion } from '../../../packages/contracts/src/career';
import { openDatabase } from '../../../packages/database/src/client';
import type { ApiConfig } from '../../../packages/config/src/index';
import { importResume } from './resume';
import { CareerErrorFilter } from './errors';
import { QuestionBank } from './bank';
import { deleteCareerDerivedPersonalData } from './career-deletion';

export const RESUME_VERSIONS = 'RESUME_VERSIONS';

const uploadFileSchema = z.object({ originalname: z.string().min(1).max(200), mimetype: z.string().max(120), buffer: z.instanceof(Buffer), size: z.number().int().positive().max(5 * 1024 * 1024) });

@Injectable()
export class ResumeVersionService {
  readonly store: CareerStore;
  readonly files: ResumeFileStore;
  readonly bank: QuestionBank;
  private readonly pool: Pool;
  constructor(readonly config: ApiConfig) {
    this.pool = openDatabase(config.DATABASE_URL).pool;
    this.store = new CareerStore(this.pool);
    this.files = new ResumeFileStore(careerDataDir(config));
    this.bank = new QuestionBank(this.pool);
  }

  private view(row: ResumeRow): ResumeVersion {
    return {
      id: row.id, label: row.label, originalName: row.original_name, contentType: row.content_type, byteSize: row.byte_size,
      attachmentSha256: row.attachment_sha256, text: row.text, textSha256: row.text_sha256, warnings: row.warnings,
      createdAt: row.created_at.toISOString(),
    };
  }

  async upload(owner: string, file: unknown) {
    const parsed = uploadFileSchema.safeParse(file);
    if (!parsed.success) throw new BadRequestException('请选择一个不超过 5 MB 的简历文件。');
    const extracted = await importResume(file);
    const extension = parsed.data.originalname.split('.').pop() ?? '';
    const stored = await this.files.put(owner, { bytes: parsed.data.buffer, extension });
    const upload = await this.store.createUpload(owner, {
      filename: extracted.filename, text: extracted.text, warnings: extracted.warnings,
      storageKey: stored.storageKey, sha256: stored.sha256, byteSize: stored.byteSize, contentType: parsed.data.mimetype || 'application/octet-stream',
    });
    // The 24h sweep claims expired staged originals and hands their real storage keys to the durable
    // purge in payload-sized chunks, so those bytes are actually removed instead of being expired out
    // of reach. An owner-scoped bounded sweep runs here; the Worker's idle reconciliation covers the
    // owners that never upload again.
    await this.store.expireStagedUploads({ owner, limit: 10 });
    return resumeUploadSchema.parse({
      filename: upload.filename, text: upload.extracted_text, warnings: upload.warnings, stagingId: upload.id,
      byteSize: upload.byte_size, attachmentSha256: upload.sha256,
    });
  }

  async save(owner: string, input: { requestId: string; stagingId: string; label: string; text: string; warningsAcknowledged: boolean }) {
    const text = normalizeSourceText(input.text).trim();
    if (text.length < 20) throw new BadRequestException('保存的简历文本至少需要 20 个字符。');
    const requestHash = digest({ kind: 'save-resume-version', stagingId: input.stagingId, label: input.label, text });
    // Replay is checked before the staging lookup so a successful save (which marks its staging
    // row saved) never makes its own idempotent retry fail as "staging expired".
    const command = await this.store.findCommand(owner, input.requestId);
    if (command) {
      if (command.kind !== 'save-resume-version' || command.request_hash !== requestHash) throw new ConflictException('IDEMPOTENCY_CONFLICT');
      const existing = command.result_id ? await this.store.getResumeVersion(owner, command.result_id) : null;
      if (!existing) throw new ConflictException('IDEMPOTENCY_CONFLICT');
      return this.view(existing);
    }
    const staging = await this.store.stagingFor(owner, input.stagingId);
    if (!staging) throw new NotFoundException('简历暂存已过期，请重新上传原始文件。');
    if (staging.warnings.length && !input.warningsAcknowledged) throw new BadRequestException('请先确认解析告警后再保存简历版本。');
    const saved = await this.store.saveResumeVersion(owner, {
      requestId: input.requestId, requestHash, stagingId: staging.id, label: input.label, text,
      attachmentSha256: staging.sha256, byteSize: staging.byte_size, contentType: staging.content_type,
      originalName: staging.filename, storageKey: staging.storage_key, warnings: staging.warnings, textSha256: textSha256(text),
    });
    return this.view(saved);
  }

  async list(owner: string) {
    const rows = await this.store.listResumeVersions(owner);
    return rows.map(row => {
      const version = this.view(row);
      return { ...version, text: undefined, textPreview: row.text.slice(0, 280) };
    });
  }

  async get(owner: string, id: string) {
    const row = await this.store.getResumeVersion(owner, id);
    if (!row) throw new NotFoundException('简历版本不存在。');
    return this.view(row);
  }

  async original(owner: string, id: string) {
    const row = await this.store.getResumeVersion(owner, id);
    if (!row) throw new NotFoundException('简历版本不存在。');
    const bytes = await this.files.read(owner, row.storage_key);
    const actual = createHash('sha256').update(bytes).digest('hex');
    if (actual !== row.attachment_sha256) throw new ConflictException('本地原始附件摘要与记录不一致，已停止下载。');
    return { bytes, filename: row.original_name, contentType: row.content_type };
  }

  async remove(owner: string, id: string, requestId: string) {
    const requestHash = digest({ kind: 'delete-resume-version', id });
    const command = await this.store.findCommand(owner, requestId);
    if (command) {
      if (command.kind !== 'delete-resume-version' || command.request_hash !== requestHash) throw new ConflictException('IDEMPOTENCY_CONFLICT');
      return { deleted: true, cancelledTaskIds: [], pendingCleanup: true };
    }
    if (!(await this.store.getResumeVersion(owner, id))) throw new NotFoundException('简历版本不存在。');
    await deleteCareerDerivedPersonalData(this.store, this.bank, owner, {
      resumeVersionId: id, preparationIds: await this.store.preparationIdsForResumeVersion(owner, id),
    });
    const deleted = await this.store.deleteResumeVersion(owner, id);
    if (!deleted) throw new NotFoundException('简历版本不存在。');
    await this.store.command(owner, requestId, 'delete-resume-version', requestHash, null, null);
    return { deleted: true, cancelledTaskIds: deleted.taskIds, pendingCleanup: true };
  }

  async close() {
    await this.pool.end();
  }
}

function ownerOf(req: Request) {
  return z.uuid().parse(req.headers['x-owner-id']);
}

function uuidParam(value: string) {
  const parsed = z.uuid().safeParse(value);
  if (!parsed.success) throw new BadRequestException('无效的资源编号。');
  return parsed.data;
}

@Controller('api/v1/resume-versions')
@UseFilters(new CareerErrorFilter())
export class ResumeVersionsController {
  constructor(@Inject(RESUME_VERSIONS) private readonly service: ResumeVersionService) {}

  @Post('uploads')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } }))
  upload(@Req() req: Request, @UploadedFile() file: unknown) {
    return this.service.upload(ownerOf(req), file);
  }

  @Post()
  save(@Req() req: Request, @Body() body: unknown) {
    return this.service.save(ownerOf(req), resumeVersionSaveSchema.parse(body));
  }

  @Get()
  list(@Req() req: Request) {
    return this.service.list(ownerOf(req));
  }

  @Get(':id')
  get(@Req() req: Request, @Param('id') id: string) {
    return this.service.get(ownerOf(req), uuidParam(id));
  }

  @Get(':id/original')
  async original(@Req() req: Request, @Param('id') id: string, @Res() res: Response) {
    const file = await this.service.original(ownerOf(req), uuidParam(id));
    res.setHeader('content-type', file.contentType || 'application/octet-stream');
    res.setHeader('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}`);
    res.setHeader('cache-control', 'no-store');
    res.setHeader('x-content-type-options', 'nosniff');
    res.end(file.bytes);
  }

  @Delete(':id')
  remove(@Req() req: Request, @Param('id') id: string, @Body() body: unknown) {
    const input = resumeDeleteSchema.parse(body);
    return this.service.remove(ownerOf(req), uuidParam(id), input.requestId);
  }
}
