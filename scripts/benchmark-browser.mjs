import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const port = Number(process.env.GRAPHIC_STUDIO_BENCHMARK_PORT ?? 5187);
const externalUrl = process.env.GRAPHIC_STUDIO_BENCHMARK_URL;
const url = externalUrl ?? `http://127.0.0.1:${port}/graphic-studio/`;
const channel = process.env.GRAPHIC_STUDIO_BROWSER_CHANNEL
  ?? (process.platform === 'win32' ? 'msedge' : 'chrome');
let server = null;

async function waitUntilReady() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Vite is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Benchmark server did not become ready at ${url}`);
}

if (!externalUrl) {
  const command = process.platform === 'win32' ? (process.env.ComSpec ?? 'cmd.exe') : 'npm';
  const args = process.platform === 'win32'
    ? ['/d', '/s', '/c', `npm.cmd run dev -- --host 127.0.0.1 --port ${port} --strictPort`]
    : ['run', 'dev', '--', '--host', '127.0.0.1', '--port', String(port), '--strictPort'];
  server = spawn(command, args, {
    cwd: process.cwd(),
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  await waitUntilReady();
}

const browser = await chromium.launch({ channel, headless: true, args: ['--enable-unsafe-webgpu'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const problems = [];
  page.on('console', (message) => {
    const text = message.text();
    if (message.type() === 'error' || /fallback|validation/i.test(text)) problems.push(`${message.type()}:${text}`);
  });
  page.on('pageerror', (error) => problems.push(`page:${error.message}`));
  const response = await page.goto(url, { waitUntil: 'domcontentloaded' });
  if (!response?.ok()) throw new Error(`Benchmark URL returned HTTP ${response?.status()}`);
  const report = await page.evaluate(async () => {
    const { runBenchmarkSuite } = await import('/graphic-studio/src/benchmark.ts');
    return runBenchmarkSuite();
  });
  if (problems.length) throw new Error(`Benchmark browser problems: ${JSON.stringify(problems)}`);
  await mkdir('benchmarks', { recursive: true });
  const output = process.env.GRAPHIC_STUDIO_BENCHMARK_OUTPUT ?? 'benchmarks/latest.json';
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(report, null, 2));
  console.log(`Benchmark written to ${output}`);
} finally {
  await browser.close();
  if (server) server.kill();
}
