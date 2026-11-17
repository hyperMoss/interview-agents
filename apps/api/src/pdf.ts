import { ServiceUnavailableException } from '@nestjs/common';
import { chromium } from 'playwright';

export async function renderLocalPdf(html: string, pageNumbers = false) {
  const browser = await chromium.launch({ headless: true }).catch(() => chromium.launch({ channel: 'chrome', headless: true })).catch(() => {
    throw new ServiceUnavailableException('无法启动本机 PDF 引擎。请安装 Chrome，或运行 pnpm exec playwright install chromium 后重试。');
  });
  const deadline = setTimeout(() => { void browser.close(); }, 30000);
  try {
    const context = await browser.newContext({ offline: true, javaScriptEnabled: false, serviceWorkers: 'block' });
    await context.route('**/*', route => route.abort());
    const page = await context.newPage();
    await page.setContent(html, { timeout: 15000 });
    await page.evaluate(() => document.fonts.ready);
    return await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true,
      displayHeaderFooter: pageNumbers, headerTemplate: '<span></span>',
      footerTemplate: '<div style="font-family:Arial;font-size:9px;width:100%;text-align:center;color:#64748b"><span class="pageNumber"></span> / <span class="totalPages"></span></div>',
    });
  } catch {
    throw new ServiceUnavailableException('PDF 生成失败或超时，内容已保留，请重试导出。');
  } finally { clearTimeout(deadline); await browser.close(); }
}
