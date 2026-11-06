import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { ResumeDraftService } from '../apps/api/src/resume-drafts';
import { migrateSqlite } from '../packages/database/src/migrate';
import { emptyResume, parseResumeDocument } from '../packages/contracts/src/resume-document';
import { resumeHtml } from '../packages/resume/src/render';
import example from '../packages/resume/example.json';
import { parseRoute, routeHash } from '../apps/web/src/navigation';

describe('JSON resume copies', () => {
  let directory: string;
  let service: ResumeDraftService;
  const owner = crypto.randomUUID();
  const stranger = crypto.randomUUID();
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'resume-drafts-'));
    const DATABASE_URL = `file:${join(directory, 'app.sqlite')}`;
    await migrateSqlite(DATABASE_URL, 'app');
    service = new ResumeDraftService({ DATABASE_URL });
  });
  afterAll(async () => { await service?.close(); if (directory) await rm(directory, { recursive: true, force: true }); });
  it('keeps copies independent across saves, stale updates, deletion and process restarts', async () => {
    const first = await service.create(owner, { id: crypto.randomUUID(), label: '通用简历', document: parseResumeDocument(example) });
    const copy = await service.create(owner, { id: crypto.randomUUID(), label: '岗位副本', document: first.document });
    const next = await service.update(owner, first.id, { label: '新名称', document: { ...first.document, name: '虚构测试姓名' }, revision: first.revision });
    expect(next.revision).toBe(2);
    await expect(service.pdf(owner, first.id, 1)).rejects.toBeInstanceOf(ConflictException);
    expect((await service.get(owner, copy.id)).document).toEqual(copy.document);
    await expect(service.update(owner, first.id, { label: '过期写入', document: emptyResume, revision: 1 })).rejects.toBeInstanceOf(ConflictException);
    await expect(service.remove(owner, first.id, 1)).rejects.toBeInstanceOf(ConflictException);
    const reopened = new ResumeDraftService({ DATABASE_URL: `file:${join(directory, 'app.sqlite')}` });
    try { expect((await reopened.get(owner, first.id)).label).toBe('新名称'); } finally { await reopened.close(); }
    await service.remove(owner, first.id, 2);
    await expect(service.get(owner, first.id)).rejects.toBeInstanceOf(NotFoundException);
    expect((await service.get(owner, copy.id)).document).toEqual(copy.document);
  });
  it('isolates owner reads, updates, deletes, exports and creation replays', async () => {
    const input = { id: crypto.randomUUID(), label: '私有副本', document: emptyResume };
    const first = await service.create(owner, input);
    expect(await service.create(owner, input)).toEqual(first);
    expect(await service.list(stranger)).toEqual([]);
    await expect(service.get(stranger, first.id)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.update(stranger, first.id, { ...input, revision: 1 })).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.remove(stranger, first.id, 1)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.pdf(stranger, first.id, 1)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.create(stranger, input)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.create(owner, { ...input, label: '不同命令' })).rejects.toBeInstanceOf(ConflictException);
  });
});
it('imports cool-resume v2 and v3 without removing extension content', () => {
  const document = parseResumeDocument(example);
  const { schemaVersion: _version, contactMethod, ...rest } = document;
  const migrated = parseResumeDocument({ ...rest, basicInfo: contactMethod, skills: [{ category: '熟悉', keywords: 'React', custom: '保留' }], order: ['header', 'basicInfo', 'skills'], schemaVersion: 2, extension: { original: true } });
  expect(migrated.schemaVersion).toBe(3);
  expect(migrated.contactMethod).toEqual(contactMethod);
  expect(migrated.order).toEqual(['header', 'skills']);
  expect(migrated.skills[0]).toEqual({ level: '熟悉', content: '熟悉: React', custom: '保留' });
  expect(migrated.extension).toEqual({ original: true });
  expect(parseResumeDocument({ ...rest, contactMethod })).toEqual(document);
  expect(() => parseResumeDocument({ ...document, schemaVersion: 99 })).toThrow();
  expect(() => parseResumeDocument({ ...document, projects: [{}] })).toThrow();
});
it('renders ordered content with escaped text, inline formatting and restrictive CSP', () => {
  const data = { ...emptyResume, name: '</title><script>alert(1)</script>', order: ['skills', 'header', 'summary'] as const, skills: [{ content: '**React** ==熟悉== <br> *TypeScript*' }], summary: { items: ['<img src="https://example.test/steal">'] } };
  const html = resumeHtml({ ...data, order: [...data.order] }, 'body{color:black}');
  expect(html).not.toContain('<script>');
  expect(html).not.toContain('<img');
  expect(html).toContain('&lt;script&gt;');
  expect(html).toContain('<strong>React</strong>');
  expect(html).toContain('<mark>熟悉</mark>');
  expect(html).toContain('<em>TypeScript</em>');
  expect(html.indexOf('专业技能')).toBeLessThan(html.indexOf('<header'));
  expect(html).toContain("default-src &#x27;none&#x27;");
});
it('restores resume deep links and preserves the existing attachment-library URL', () => {
  const route = { page: 'resumeStudio', resumeId: crypto.randomUUID() } as const;
  expect(parseRoute(routeHash(route))).toEqual(route);
  expect(parseRoute('#/resumes/bad-id')).toEqual({ page: 'resumeStudio' });
  expect(parseRoute('#/settings/resumes')).toEqual({ page: 'resumeLibrary' });
});
