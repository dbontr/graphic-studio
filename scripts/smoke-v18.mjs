import { chromium } from 'playwright';

const url = process.env.GRAPHIC_STUDIO_SMOKE_URL ?? 'http://127.0.0.1:5173/graphic-studio/';
const channel = process.env.GRAPHIC_STUDIO_BROWSER_CHANNEL;
const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-webgpu'],
  ...(channel ? { channel } : {}),
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
const problems = [];
page.on('console', (message) => {
  const text = message.text();
  if (message.type() === 'error' || /fallback|validation/i.test(text)) problems.push(`${message.type()}:${text}`);
});
page.on('pageerror', (error) => problems.push(`page:${error.message}`));

async function addNode(label) {
  await page.getByRole('button', { name: 'Add node' }).click();
  const search = page.locator('.node-palette-search input');
  await search.fill(label);
  await page.locator('.node-palette button').filter({ hasText: label }).first().click();
}

try {
  await page.addInitScript(() => localStorage.clear());
  const response = await page.goto(url, { waitUntil: 'domcontentloaded' });
  if (!response?.ok()) throw new Error(`Smoke URL returned HTTP ${response?.status()}`);
  await page.waitForSelector('canvas.preview-canvas', { timeout: 20_000 });

  const adjust = page.locator('.studio-node--adjust').first();
  const dither = page.locator('.studio-node--dither').first();
  await adjust.click();
  await dither.click({ modifiers: ['Control'] });
  const selection = page.locator('.selection-toolbar');
  await selection.waitFor();
  const selectedText = (await selection.innerText()).replace(/\s+/g, ' ');
  if (!selectedText.includes('2 selected')) throw new Error(`Multi-select failed: ${selectedText}`);
  await selection.getByRole('button', { name: 'Subgraph' }).click();
  const subgraph = page.locator('.studio-node--subgraph').first();
  await subgraph.waitFor();
  const summary = await subgraph.innerText();
  if (!/nodes/.test(summary) || !/exposed parameters/.test(summary)) throw new Error('Subgraph summary missing.');
  await subgraph.locator('summary').click();
  if (await subgraph.locator('.subgraph-inspector-list > div').count() < 2) {
    throw new Error('Subgraph inspector did not expose its internal graph.');
  }

  await subgraph.click();
  await page.locator('.selection-toolbar').getByRole('button', { name: 'Save preset' }).click();
  const presetPanel = page.locator('.preset-panel');
  await presetPanel.waitFor();
  if (await presetPanel.locator('.preset-card').count() < 7) throw new Error('Preset library is incomplete.');
  if (!(await presetPanel.innerText()).includes('My preset')) throw new Error('Saved preset did not persist.');
  await presetPanel.getByRole('button', { name: 'Close presets' }).click();

  await page.getByRole('button', { name: 'Batch' }).click();
  const batch = page.locator('.batch-panel');
  await batch.waitFor();
  const formatSelect = batch.locator('.batch-options select').nth(0);
  const dimensionSelect = batch.locator('.batch-options select').nth(1);
  await formatSelect.selectOption('webp');
  await dimensionSelect.selectOption('1024');
  await batch.locator('input[type="file"]').evaluate(async (input) => {
    const canvas = document.createElement('canvas');
    canvas.width = 8; canvas.height = 8;
    const context = canvas.getContext('2d');
    context.fillStyle = '#7fbf4d'; context.fillRect(0, 0, 8, 8);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    const transfer = new DataTransfer();
    transfer.items.add(new File([blob], 'smoke.png', { type: 'image/png' }));
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await batch.getByRole('button', { name: /Run queue/ }).click();
  await page.waitForFunction(() => /complete|failed|cancelled/i.test(document.querySelector('.batch-list')?.textContent ?? ''), null, { timeout: 20_000 });
  const batchText = await batch.innerText();
  if (!batchText.includes('Complete')) throw new Error(`Batch item did not complete: ${batchText}`);
  const downloadPromise = page.waitForEvent('download');
  await batch.getByRole('button', { name: /Download ZIP/ }).click();
  const download = await downloadPromise;
  if (!download.suggestedFilename().endsWith('.zip')) throw new Error('Batch ZIP download did not complete.');
  await batch.getByRole('button', { name: 'Close batch' }).click();

  for (const label of ['Text', 'Shape', 'Gradient', 'Generator', 'Overlay']) await addNode(label);
  const expectedClasses = ['text', 'shape', 'gradient', 'generator', 'overlay'];
  for (const kind of expectedClasses) {
    if (await page.locator(`.studio-node--${kind}`).count() < 1) throw new Error(`Missing ${kind} authoring node.`);
  }

  const overlay = page.locator('.studio-node--overlay').last();
  const overlayText = await overlay.textContent() ?? '';
  if (!overlayText.includes('Anchor X') || !overlayText.includes('Anchor Y')) throw new Error('Overlay anchor controls missing.');
  if (await overlay.locator('.blend-handle').count() !== 2) throw new Error('Overlay inputs missing.');
  if (await page.locator('.studio-node--generator select option').count() < 11) throw new Error('Generator family incomplete.');
  if (await page.locator('.studio-node--shape select option').count() < 6) throw new Error('Shape family incomplete.');
  if (await page.locator('.studio-node--gradient .gradient-stop-row').count() < 2) throw new Error('Gradient stop editor missing.');
  if (await page.locator('.studio-node--text textarea').count() !== 1) throw new Error('Text editor missing.');
  if (await page.locator('.node-reset').count() < 5) throw new Error('Generic reset controls missing.');

  const nodeCount = await page.locator('.react-flow__node').count();
  if (!(await page.locator('.selection-toolbar').count())) throw new Error('Selection state was lost before shortcut checks.');
  await page.keyboard.press('Control+d');
  await page.waitForTimeout(50);
  if (await page.locator('.react-flow__node').count() !== nodeCount + 1) throw new Error('Duplicate shortcut failed.');
  await page.keyboard.press('Control+c');
  await page.keyboard.press('Control+v');
  await page.waitForTimeout(50);
  if (await page.locator('.react-flow__node').count() !== nodeCount + 2) throw new Error('Copy/paste shortcut failed.');

  await page.getByRole('button', { name: 'Performance' }).click();
  const performance = page.locator('.performance-panel');
  await performance.waitFor();
  if (!(await performance.innerText()).includes('GPU passes')) throw new Error('Performance telemetry panel is incomplete.');

  console.log('V18_UI', JSON.stringify({ subgraph: true, presets: true, batch: true, authoringNodes: true, shortcuts: true }));
  console.log('PROBLEMS', JSON.stringify(problems));
  if (problems.length) throw new Error(`Browser problems: ${JSON.stringify(problems)}`);
} finally {
  await browser.close();
}
