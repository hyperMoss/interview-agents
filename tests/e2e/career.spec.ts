import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { startProviderFixture } from '../provider-fixture';

// Local BOSS career e2e. Two levels of evidence:
//  * resume library + career landing guards need only the local stack (API, SQLite, private storage);
//  * search → review → approval → delivery needs the Worker pointed at the synthetic BOSS site, so the whole
//    stack has to be started with BOSS_SITE_ORIGIN=<synthetic origin>. That run is gated by CAREER_E2E_SITE_ORIGIN
//    and is never reported as passed without it.
//
// Prerequisites for the gated part (documented in docs/design/boss-career-workflow.md):
//   1. isolated SQLite files: configure temporary DATABASE_URL / AGENT_DATABASE_URL, then pnpm db:migrate
//   2. full local stack with a synthetic origin, e.g. env BOSS_SITE_ORIGIN=... BOSS_BROWSER_ENGINE=playwright pnpm dev
//   3. a dedicated session that already finished human login (the fixture starts logged in for this synthetic run)
// No real BOSS request, login or submission happens in this file; every identity is synthetic.

const headers = { Origin: 'http://localhost:5173' };
const SITE = process.env.CAREER_E2E_SITE_ORIGIN;
const resumeText = '固定测试经历：负责前端页面与接口联调，用自动化测试验证请求竞争与页面状态一致性。';
const syntheticResume = Buffer.from(`${resumeText}\n仅用于本地软件验收的合成简历，不代表任何真实候选人。\n`, 'utf8');

async function openCareer(page: Page) {
  await page.goto('/#/career');
  await expect(page.getByRole('heading', { name: '本机 BOSS 求职', exact: true })).toBeVisible();
}
async function uploadResume(page: Page, label: string) {
  await page.goto('/#/settings/resumes');
  await expect(page.getByRole('heading', { name: '投递附件库', exact: true })).toBeVisible();
  await page.getByLabel('选择简历原始文件（只在本机解析，不会上传到 BOSS）').setInputFiles({ name: 'synthetic-resume.txt', mimeType: 'text/plain', buffer: syntheticResume });
  await page.getByLabel('版本名称（仅用于你自己区分版本）').fill(label);
  await page.getByRole('button', { name: '保存为不可变版本', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '已保存不可变版本' })).toBeVisible();
  await expect(page.getByRole('button', { name: new RegExp(label) })).toBeVisible();
  // Saving a version opens its detail automatically; the panel shows the read-only snapshot and the original download.
  await expect(page.getByLabel(/该版本的提取文本（只读/)).toBeVisible();
}

test.describe('career resume library and landing guards', () => {
  test.setTimeout(90000);
  test.use({ actionTimeout: 10000 });

  test('an immutable resume version keeps the exact original bytes and can be downloaded then deleted', async ({ page }) => {
    await page.request.get('/api/v1/identity');
    await uploadResume(page, '合成简历 A');

    const versions = await (await page.request.get('/api/v1/resume-versions')).json();
    const created = (versions as Array<{ id: string; label: string; textSha256: string; attachmentSha256: string }>).find(item => item.label === '合成简历 A');
    if (!created) throw new Error('Saved version missing from the library API');
    expect(created.attachmentSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(created.textSha256).toMatch(/^[0-9a-f]{64}$/);
    const download = await page.request.get(`/api/v1/resume-versions/${created.id}/original`);
    expect(download.ok()).toBe(true);
    const bytes = await download.body();
    expect(bytes.equals(syntheticResume)).toBe(true);

    // The UI shows both the corrected text and the downloadable original before approval.
    await expect(page.getByLabel(/该版本的提取文本（只读/)).toHaveValue(new RegExp('固定测试经历'));
    const fileDownload = page.waitForEvent('download');
    await page.getByRole('button', { name: '下载原始文件', exact: true }).click();
    const path = await (await fileDownload).path();
    if (!path) throw new Error('Missing original download');
    expect((await readFile(path)).equals(syntheticResume)).toBe(true);

    await page.getByRole('button', { name: '删除这个版本及派生数据', exact: true }).click();
    // The confirmation names the personal records that only exist outside the resume tables.
    await expect(page.getByText(/由这些备题保存到题库的题目/)).toBeVisible();
    await expect(page.getByText(/整个严格面试/)).toBeVisible();
    await page.getByRole('button', { name: '确认删除版本', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: '已删除该版本' })).toBeVisible();
    await expect(page.getByRole('button', { name: new RegExp('合成简历 A') })).toHaveCount(0);
  });

  test('the landing page blocks a manual start without a model connection and never invents a ready session', async ({ page }) => {
    await page.request.get('/api/v1/identity');
    await page.request.delete('/api/v1/models/settings', { headers });
    await uploadResume(page, '合成简历 B');
    await openCareer(page);
    await expect(page.getByText('需要先在模型设置里启用一个自带模型连接')).toBeVisible();
    await expect(page.getByRole('button', { name: '开始本机搜索', exact: true })).toBeDisabled();
    // Session state is whatever the worker actually observed; the page must not claim "已就绪" by itself.
    await expect(page.locator('.career-session')).toContainText('本机 BOSS 会话');
    await expect(page.getByRole('button', { name: /打开 BOSS 登录\/验证|重新打开并聚焦本机浏览器/ })).toBeVisible();
    await expect(page.getByText('手机可以查看状态、审批与恢复')).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: 'docs/evidence/screenshots/career-landing-mobile.png', fullPage: true });
  });
});

test.describe('career search, approval, delivery and preparation', () => {
  test.setTimeout(240000);
  test.use({ actionTimeout: 15000 });
  test.skip(!SITE, '需要 Worker 指向合成 BOSS 站点的本机栈（CAREER_E2E_SITE_ORIGIN）；真实站点不在本测试范围。');

  test('reads postings through native filters, freezes the approved greetings and resume, then shows each phase honestly', async ({ page }) => {
    const provider = await startProviderFixture();
    try {
      await page.request.get('/api/v1/identity');
      // The provider fixture accepts only its own credential pairs; using another model name would test
      // fixture authentication instead of the career flow.
      const enabled = await page.request.post('/api/v1/models/settings', { headers, data: { baseUrl: provider.baseUrl, model: 'coach-alpha', apiKey: 'fixture-alpha-key', remember: false, timeoutMs: 10000 } });
      expect(enabled.ok()).toBe(true);
      const session = await page.request.get('/api/v1/career/boss/session');
      expect(session.ok()).toBe(true);
      await uploadResume(page, '合成简历 C');
      await openCareer(page);

      await page.locator('#career-resume').click();
      await page.getByRole('option', { name: /合成简历 C/ }).click();
      await page.locator('#career-blacklist').click();
      await page.keyboard.type('人才服务');
      await page.keyboard.press('Enter');
      await page.getByRole('checkbox', { name: /我了解：所选简历的提取文本/ }).check();
      await page.getByRole('button', { name: '开始本机搜索', exact: true }).click();

      // The worker scan populates the posting list first; wait for the disposition tabs to prove reads.
      await expect(page.getByRole('heading', { name: /^任务 / })).toBeVisible({ timeout: 20000 });
      await expect(page.getByRole('tab', { name: /^可投递 \d+/ })).toBeVisible({ timeout: 120000 });
      await expect(page.getByRole('tab', { name: /^已排除 \d+/ })).toBeVisible();
      // Native filter evidence lives inside each posting detail; open a read posting to verify the captured controls.
      await page.locator('.career-posting-open').first().click();
      await expect(page.getByText('原生筛选证据（读取该岗位时的站点控件）').first()).toBeVisible();
      // Excluded rows stay visible with their source evidence; open the blacklisted posting to see the match.
      await page.getByRole('tab', { name: /^已排除 \d+/ }).click();
      await page.locator('.career-posting-open').filter({ hasText: '人才服务' }).first().click();
      await expect(page.getByText('命中公司黑名单关键词').first()).toBeVisible();

      // Wait until the worker scan settles into the review phase; the frozen task revision is only
      // stable then, so approving earlier would race the final phase transition and return a 409.
      await expect(page.getByText('待你复核', { exact: true })).toBeVisible({ timeout: 120000 });

      // Deleting the task discloses the derived bank questions and the whole strict interviews it removes.
      await page.getByRole('button', { name: '删除任务', exact: true }).click();
      await expect(page.getByText('删除任务及其个人快照？')).toBeVisible();
      await expect(page.getByText(/由这些备题保存到题库的题目/)).toBeVisible();
      await expect(page.getByText(/整个严格面试/)).toBeVisible();
      await page.getByRole('tooltip').filter({ hasText: '删除任务及其个人快照？' }).getByRole('button', { name: /^保\s*留$/ }).click();
      await expect(page.getByText('删除任务及其个人快照？')).not.toBeVisible();

      // Editing a greeting persists the draft; approval shows the exact final text and the fixed attachment.
      await page.getByRole('tab', { name: /^可投递 \d+/ }).click();
      await page.locator('.career-posting-open').first().click();
      const finalGreeting = await page.getByLabel(/^招呼语（草稿版本/).inputValue();
      const edited = `${finalGreeting.slice(0, 200)} 我已核对这段文字再发送。`;
      await page.getByLabel(/^招呼语（草稿版本/).fill(edited);
      await page.getByRole('button', { name: '保存招呼语草稿', exact: true }).click();
      await expect(page.getByRole('status').filter({ hasText: '招呼语草稿已保存' })).toBeVisible();
      // The per-row checkbox must drop the posting from the batch when unchecked, not only add it.
      const rowCheckbox = page.getByRole('checkbox', { name: /^选择 / }).first();
      await rowCheckbox.check();
      await expect(page.locator('.career-selection')).toContainText('已选 1/10 个可投递岗位');
      await rowCheckbox.uncheck();
      await expect(rowCheckbox).not.toBeChecked();
      await expect(page.locator('.career-selection')).toContainText('已选 0/10 个可投递岗位');
      await rowCheckbox.check();
      await expect(page.locator('.career-selection')).toContainText('已选 1/10 个可投递岗位');
      await page.getByRole('button', { name: /^审批所选的 \d+ 个岗位$/ }).click();
      await expect(page.getByRole('heading', { name: '确认这一批', exact: true })).toBeVisible();
      await expect(page.getByText('原始文件摘要')).toBeVisible();
      await expect(page.getByLabel(/最终招呼语（会按此处文字原样发送）/).first()).toHaveValue(edited);
      const approve = page.getByRole('button', { name: /确认冻结并批准这批/ });
      await expect(approve).toBeDisabled();
      await page.getByRole('checkbox', { name: /我已逐条核对上面/ }).check();

      // A transport failure must stay inside the mounted approval panel: the final texts and the
      // idempotency key survive, so the retry submits the same request id instead of a second batch.
      const approvalBodies: string[] = [];
      await page.route('**/api/v1/career/tasks/*/approve', async route => {
        approvalBodies.push(route.request().postData() ?? '');
        if (approvalBodies.length === 1) {
          await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: '审批提交暂时不可用（合成故障）。', code: 'UNAVAILABLE' }) });
          return;
        }
        await route.continue();
      });
      await approve.click();
      await expect(page.getByRole('alert').filter({ hasText: '审批没有提交成功：审批提交暂时不可用（合成故障）' })).toBeVisible();
      await expect(page.getByLabel(/最终招呼语（会按此处文字原样发送）/).first()).toHaveValue(edited);
      await expect(page.getByRole('checkbox', { name: /我已逐条核对上面/ })).toBeChecked();
      await approve.click();

      // Delivery view separates conversation, consent, attachment and preparation; no ambiguous success banner.
      await expect(page.getByRole('heading', { name: /^批次 / })).toBeVisible({ timeout: 30000 });
      await page.unroute('**/api/v1/career/tasks/*/approve');
      const retried = approvalBodies.map(body => (JSON.parse(body) as { requestId: string }).requestId);
      expect(retried).toHaveLength(2);
      expect(retried[1]).toBe(retried[0]);
      await expect(page.getByText('冻结的外发内容')).toBeVisible();
      await expect(page.locator('.career-batch-item').first()).toContainText('沟通：');
      await expect(page.locator('.career-batch-item').first()).toContainText('附件：');
      await expect(page.locator('.career-batch-item').first()).toContainText('备题：');
      await page.screenshot({ path: 'docs/evidence/screenshots/career-batch-desktop.png', fullPage: true });

      // The personalized preparation keeps ten questions with JD/resume sources and a private export.
      await expect(page.getByRole('button', { name: '打开备题', exact: true }).first()).toBeVisible({ timeout: 120000 });
      await page.getByRole('button', { name: '打开备题', exact: true }).first().click();
      await expect(page.locator('.career-prep-question')).toHaveCount(10, { timeout: 120000 });
      await expect(page.getByText('缺口准备（不代表已有经历）').first()).toBeVisible();
      const exported = page.waitForEvent('download');
      await page.getByRole('button', { name: '导出 Markdown', exact: true }).click();
      const path = await (await exported).path();
      if (!path) throw new Error('Missing preparation export');
      const markdown = await readFile(path, 'utf8');
      expect(markdown).toContain('JD 原文');
      await page.setViewportSize({ width: 390, height: 844 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    } finally {
      await page.request.delete('/api/v1/models/settings', { headers });
      await provider.close();
    }
  });
});
