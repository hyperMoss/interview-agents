# Create and manage JSON resumes

1. Open **简历管理 → 简历库** in the left module menu. On mobile, open **菜单** first.
2. Choose **新建空白简历**, **从示例开始**, or **导入 JSON**.
3. Edit the copy name and JSON. The preview updates when the JSON is valid. If parsing fails, the editor keeps your text and shows the last valid preview.
4. Select a theme and click **保存修改**.
5. Use **另存为副本** to create an independent copy for another role. Rename a copy by changing its name and saving.

Import a version file from cool-resume, such as `data/versions/<id>.json`. Import each version separately. The importer accepts v3, v3 without an explicit version, and v2 with the original contact and skill fields. It upgrades v2 to v3 and retains extension content. It does not read cool-resume's private data directory automatically.

## Import an existing resume file

Select **导入简历文件** to parse PDF, DOCX, TXT or Markdown on the local machine. Check the extracted text and any warnings, give the resume a name, then choose **转换并存入简历库**. The saved JSON contains the full corrected text and source filename. Clearly labeled name, target role and experience fields are mapped; unclassified lines stay in the summary for manual organization. The converter does not invent employment or project entries. Scanned PDFs need OCR before import.

Import creates an editable JSON copy, not an immutable original attachment. To retain original attachment bytes, upload the original separately in **投递附件库**. Creating a generated PDF version follows the existing export flow below.

## Use a saved resume for an interview

Save the JSON copy, then select **用于面试** and confirm replacing the current interview preparation draft. A text snapshot is copied to **面试中心 → 面试准备**; fill in the target JD and confirm the plan. You can also use **从简历库选择** inside interview preparation. Text must be 20–16000 characters; longer content is rejected without truncation. Later changes to the copy do not alter an existing interview.

Interview records are under **面试中心 → 面试历史**, rather than the global sidebar. Filter records by role/status and open one to continue or review its report. Model, search and local-data settings belong to **系统设置**; attachments belong to **简历管理**.

Unsaved JSON stays in the current tab's session storage across page navigation and refresh. Save changes before closing the tab. Saved copies live in the local API's SQLite database and belong to the current signed browser identity. General workspace backups do not include these copies. Export JSON to back them up.

## Export a resume

- Click **导出 JSON** to download the current valid document, including unsaved edits and extension fields.
- Click **导出 HTML** to download a self-contained document with its styles.
- Save changes, then click **导出 PDF** to download an A4 PDF of that saved revision.

PDF generation uses a fresh, headless local Chromium instance. It does not use the BOSS browser profile. If Chromium is unavailable, install Google Chrome or run `pnpm exec playwright install chromium`. You can also open the exported HTML and print it from a browser.

The preview offers **查看原始大小** and **适应宽度**. Long resumes scroll inside the preview. PDF export includes the complete document with automatic page breaks.

## Save a PDF for career tasks

1. Save the JSON copy.
2. Click **保存为投递版本**.
3. Open **查看附件库** and check the extracted text and original PDF.
4. Select that immutable version when preparing a career task.

The attachment library keeps the generated PDF bytes and their SHA-256 digest. Editing or deleting the JSON copy does not change that attachment or an existing task. Delete attachments separately in the attachment library when required.

If PDF extraction reports a warning, download the PDF and upload it through the attachment library. Review and correct the extracted text before saving.

If a save response is lost, **重试这个投递版本请求** reuses the saved request ID and staging ID. The request remains available after refreshing the same tab. Finish that request before creating a newer attachment.

## Resolve a conflict

If another tab saves the same copy, the API rejects an update based on the old revision. Your JSON stays in the editor.

To preserve both versions, click **另存为副本**. To merge changes, export your JSON, click **重新读取**, and apply your edits to the current revision.

## Run the verification

```sh
pnpm exec vitest run tests/resume-drafts.test.ts tests/sqlite.test.ts tests/dev-origin.test.ts tests/workspace.test.ts
pnpm test:e2e:resumes
pnpm build
```

The browser suite starts its own API and Vite processes on ports 15300 and 15173, creates temporary SQLite databases, and disables BOSS automation. It requires Chrome. It covers independent copies, stale revisions, owner isolation, rejected foreign origins, draft recovery, PDF export, attachment digests, lost-response retries, deletion, and the mobile menu. Screenshots and failure traces go to the ignored `test-results/resumes` directory. Test records use fictional resume data.

For an existing installation, run `pnpm db:migrate` before starting the updated API. The migration adds `app_resume_drafts` without changing existing resume attachments.

## Implementation references

- Shared JSON and wire contracts: `packages/contracts/src/resume-document.ts`.
- NestJS CRUD and local PDF generation: `apps/api/src/resume-drafts.ts`.
- React editor and preview: `apps/web/src/resume-studio.tsx`.
- Rendering and themes: `packages/resume/src`.

The themes, layout, and fictional example originate from the local cool-resume project. Its MIT notice is retained in `packages/resume/COOL-RESUME-LICENSE`. The renderer uses React's escaped text nodes and limited inline formatting. Exported HTML blocks scripts and network resources through a content security policy. The preview also runs in a sandboxed iframe, and the PDF browser blocks network requests.

Green includes green section icons and heading rules, not just color variables. It uses zero top/bottom outer margins and padding in preview and export, while retaining horizontal spacing. The React section icons retain their Lucide/Feather ISC notice in the renderer source and exported HTML.
