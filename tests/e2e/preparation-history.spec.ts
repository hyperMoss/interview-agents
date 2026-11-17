import {test,expect} from '@playwright/test';
import {startProviderFixture} from '../provider-fixture';
import {navigateModule} from './ui-helpers';
test('keeps failed and successful preparation history, retries with an immutable source and restores the editor',async({page})=>{
  const provider=await startProviderFixture();
  const jd='负责 React 和 TypeScript 企业管理前端开发，集成 REST API，验证状态一致性和自动化测试。';
  try{
    await page.goto('/#/home');await page.request.get('/api/v1/identity');const headers={Origin:new URL(page.url()).origin};
    expect((await page.request.post('/api/v1/models/settings',{headers,data:{baseUrl:provider.baseUrl,model:'coach-alpha',apiKey:'fixture-alpha-key',remember:false,timeoutMs:10000}})).ok()).toBe(true);
    await page.reload();await navigateModule(page,'JD 备题');
    await page.getByLabel('备题岗位',{exact:true}).fill('企业前端工程师');await page.getByRole('textbox',{name:'备题 JD',exact:true}).fill(jd);await page.getByLabel('预生成题量',{exact:true}).fill('3');
    provider.state.preparationResponse='truncated';
    await page.getByRole('button',{name:'根据 JD 生成题单',exact:true}).click();await expect(page.locator('main').getByRole('alert').filter({hasText:/\S/})).toContainText('长度上限');
    await navigateModule(page,'备题历史');await page.locator('.preparation-history-row').first().click();
    await expect(page.locator('.preparation-history-detail')).toContainText('PREPARATION_OUTPUT_LIMIT');
    const failedUrl=page.url();await page.reload();await expect(page.locator('.preparation-history-detail')).toContainText('长度上限');
    provider.state.preparationResponse='valid';
    await page.getByRole('button',{name:'重试生成',exact:true}).click();await expect(page.locator('.preparation-history-detail .preparation-card')).toHaveCount(3);
    expect(page.url()).not.toBe(failedUrl);await expect(page.locator('.preparation-history-row')).toHaveCount(2);
    const successUrl=page.url();await page.reload();await expect(page.locator('.preparation-history-detail .preparation-card')).toHaveCount(3);
    await expect(page.locator('.preparation-history-detail .preparation-card').first().locator('ol > li')).toHaveCount(4);
    await page.context().grantPermissions(['clipboard-read','clipboard-write']);
    await page.getByRole('button',{name:'复制 Markdown',exact:true}).click();
    await expect(page.getByRole('status').filter({hasText:'已复制 Markdown'})).toBeVisible();
    const shared=await page.evaluate(()=>navigator.clipboard.readText());
    expect(shared).toContain('# 企业前端工程师备题单');expect(shared).toContain('### 3.');expect(shared).toContain(jd);

    await page.getByRole('button',{name:'查看重试来源',exact:true}).click();await expect(page).toHaveURL(failedUrl);await expect(page.locator('.preparation-history-detail')).toContainText('长度上限');
    await page.goto(successUrl);await page.getByRole('button',{name:'载入题单继续编辑',exact:true}).click();await page.getByRole('button',{name:'载入记录',exact:true}).click();
    await expect(page.getByRole('textbox',{name:'备题 JD',exact:true})).toHaveValue(jd);await expect(page.locator('.preparation-card')).toHaveCount(3);
    await page.locator('.preparation-card').first().getByText('参考回答与追问，可编辑',{exact:true}).click();
    await expect(page.getByRole('textbox',{name:'题目 1 参考回答',exact:true})).toHaveValue(/^1\. [\s\S]+\n\n2\. [\s\S]+\n\n3\. [\s\S]+\n\n4\./);
    await navigateModule(page,'备题历史');await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
    await page.screenshot({path:'test-results/preparation/history-mobile.png',fullPage:true});
    const history=await(await page.request.get('/api/v1/preparations/history')).json();expect(history.items).toHaveLength(2);expect(JSON.stringify(history)).not.toContain('fixture-alpha-key');
  }finally{await page.request.delete('/api/v1/models/settings',{headers:{Origin:new URL(page.url()).origin}});await provider.close();}
});
