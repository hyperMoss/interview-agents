import { test, expect } from '@playwright/test';
import { PDFParse } from 'pdf-parse';
import { readFile } from 'node:fs/promises';

const compact = (text: string) => text.normalize('NFKC').replace(/\s/g, '');

async function pdfText(path: string) {
  const parser = new PDFParse({ data: new Uint8Array(await readFile(path)) });
  try { return await parser.getText(); } finally { await parser.destroy(); }
}

test('exports edited JD answers and immutable history to private, complete A4 PDFs', async ({ page, browser }) => {
  await page.goto('/#/preparation');
  const jd = '熟悉 React 和 TypeScript，负责复杂页面状态与性能优化。优先考虑熟悉自动化测试的候选人。';
  await page.getByRole('textbox', { name: '备题岗位', exact: true }).fill('前端 PDF 验收');
  await page.getByRole('textbox', { name: '备题 JD', exact: true }).fill(jd);
  await page.getByRole('button', { name: '根据 JD 生成题单', exact: true }).click();
  await expect(page.locator('.preparation-card')).toHaveCount(6);
  const long = Array.from({ length: 80 }, (_, i) => `${i + 1}. ${'中文长答案分段验收，说明约束、实现、取舍与验证。'.repeat(4)}`).join('\n\n').slice(0, 7200);
  for (let index = 0; index < 6; index++) {
    await page.locator('.preparation-card').nth(index).locator('summary').click();
    await page.getByRole('textbox', { name: `题目 ${index + 1} 参考回答`, exact: true }).fill(`${long}\n\n编辑答案尾部标记${index + 1}`);
  }
  const editedQuestion = '编辑后的题面：如何核对请求竞争？<script>alert("不会执行")</script>';
  await page.getByRole('textbox', { name: '题目 1 题面', exact: true }).fill(editedQuestion);
  const sent = page.waitForRequest(request => request.url().endsWith('/preparations/pdf') && request.method() === 'POST');
  const response = page.waitForResponse(response => response.url().endsWith('/preparations/pdf') && response.request().method() === 'POST');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 PDF', exact: true }).click();
  expect(Buffer.byteLength((await sent).postData() ?? '')).toBeGreaterThan(128 * 1024);
  const rendered = await response;
  expect(rendered.status(), rendered.ok() ? 'PDF response' : await rendered.text()).toBe(201);
  const pdf = await download;
  expect(pdf.suggestedFilename()).toBe('前端 PDF 验收备题单.pdf');
  const editedPath = 'test-results/preparation/edited.pdf';
  await pdf.saveAs(editedPath);
  const text = await pdfText(editedPath);
  expect(text.total).toBeGreaterThan(3);
  expect(compact(text.text)).toContain(compact(editedQuestion));
  for (let index = 1; index <= 6; index++) expect(compact(text.text)).toContain(`编辑答案尾部标记${index}`);
  expect(text.text).toContain('规则演示');
  expect(compact(text.text)).toContain('参考回答用于学习与复述');
  await expect(page.getByRole('textbox', { name: '题目 1 题面', exact: true })).toHaveValue(editedQuestion);

  const history = await (await page.request.get('/api/v1/preparations/history')).json();
  const id = history.items[0].id;
  const stranger = await browser.newContext();
  try { expect((await stranger.request.get(new URL(`/api/v1/preparations/history/${id}/pdf`, page.url()).href)).status()).toBe(404); }
  finally { await stranger.close(); }
  const headers = { Origin: new URL(page.url()).origin };
  expect((await page.request.post('/api/v1/preparations/pdf', { headers, data: {} })).status()).toBe(400);
  expect((await page.request.post('/api/v1/preparations/pdf', { headers: { Origin: 'https://untrusted.invalid' }, data: {} })).status()).toBe(403);
  const privateResponse = await page.request.get(`/api/v1/preparations/history/${id}/pdf`);
  expect(privateResponse.headers()['cache-control']).toBe('no-store');
  expect(privateResponse.headers()['content-type']).toContain('application/pdf');

  await page.goto(`/#/preparation/history/${id}`);
  await expect(page.locator('.preparation-history-detail .preparation-card')).toHaveCount(6);
  const originalDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 PDF', exact: true }).click();
  const original = await originalDownload;
  const originalPath = 'test-results/preparation/history.pdf';
  await original.saveAs(originalPath);
  const originalText = await pdfText(originalPath);
  expect(originalText.text).not.toContain('编辑答案尾部标记');
  expect(compact(originalText.text)).toContain('熟悉React和TypeScript');
  expect(compact(originalText.text)).toContain('参考回答');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: '导出 PDF', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
