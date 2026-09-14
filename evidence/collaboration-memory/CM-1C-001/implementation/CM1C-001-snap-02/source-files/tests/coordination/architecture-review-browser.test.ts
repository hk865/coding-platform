import { expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { architectureReviewScenario } from './architecture-review-scenario.js';
import { architectureReviewView } from '../../src/data/read-model-index/architecture-review-view.js';
const requireUi = createRequire(resolve('src/ui/package.json'));
for (const outcome of ['accept', 'reject', 'defer', 'modify'] as const)
    it.skipIf(!process.env['C1_BROWSER'])('browser decision uses canonical ' + outcome, async () => {
        await architectureReviewScenario(outcome, { choose: async (entry, ledger, scope, input) => {
                const { createServer } = await import(pathToFileURL(requireUi.resolve('vite')).href);
                const { chromium } = await import(pathToFileURL(requireUi.resolve('playwright-core')).href);
                let resolveChoice!: (value: Awaited<ReturnType<typeof entry.decide>>) => void;
                const choice = new Promise<Awaited<ReturnType<typeof entry.decide>>>(r => { resolveChoice = r; });
                const server = await createServer({ root: resolve('src/ui'), configFile: false, server: { host: '127.0.0.1', port: 0 }, plugins: [{ name: 'canonical-architecture-test-host', configureServer(v: any) {
                                v.middlewares.use(async (req: any, res: any, next: any) => {
                                    if (!req.url.startsWith('/api/real/architecture-reviews/'))
                                        return next();
                                    if (req.headers['x-platform-token'] !== 'browser-scenario') {
                                        res.statusCode = 403;
                                        res.end('{}');
                                        return;
                                    }
                                    try {
                                        let raw = '';
                                        for await (const part of req)
                                            raw += part;
                                        const body = JSON.parse(raw);
                                        const result = req.url.endsWith('/view') ? await architectureReviewView(ledger, scope) : await entry.decide(scope, body);
                                        res.setHeader('content-type', 'application/json');
                                        res.end(JSON.stringify(result));
                                        if (req.url.endsWith('/decide')) {
                                            Object.assign(input, body);
                                            resolveChoice(result as Awaited<ReturnType<typeof entry.decide>>);
                                        }
                                    }
                                    catch (e) {
                                        res.statusCode = 400;
                                        res.end(JSON.stringify({ error: String(e) }));
                                    }
                                });
                            } }] });
                await server.listen();
                const browser = await chromium.launch({ executablePath: process.env['CHROME_PATH'], headless: true, args: ['--no-sandbox'] });
                try {
                    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
                    await page.goto(server.resolvedUrls.local[0] + 'tests/architecture-review-page.html');
                    const card = page.getByTestId('architecture-review');
                    await card.waitFor({ state: 'visible' });
                    expect(await card.innerText()).toContain('Record.id');
                    expect(await card.innerText()).toContain(String(input['proposalDigest']));
                    await page.getByLabel('决定说明', { exact: true }).fill(String(input['summary']));
                    if (outcome === 'modify')
                        await page.getByLabel('修改后的方案说明（修改会产生新提案）', { exact: true }).fill(String(input['description']));
                    const out = resolve('evidence/collaboration-memory/CM-1C-001/implementation/continuation-01/browser');
                    await mkdir(out, { recursive: true });
                    await page.screenshot({ path: resolve(out, outcome + '-pending.png'), fullPage: true });
                    await page.getByRole('button', { name: { accept: '接受', reject: '拒绝', defer: '延后', modify: '修改并重新待决' }[outcome], exact: true }).click();
                    const receipt = await choice;
                    expect(receipt).toMatchObject({ status: 'committed' });
                    await expect.poll(async () => card.innerText(), { timeout: 15000 }).toContain(outcome === 'modify' ? '版本 2' : ({ accept: '已接受', reject: '已拒绝', defer: '已延后' } as const)[outcome]);
                    await page.screenshot({ path: resolve(out, outcome + '-recorded.png'), fullPage: true });
                    return receipt;
                }
                finally {
                    await browser.close();
                    await server.close();
                }
            } });
    }, 120000);
