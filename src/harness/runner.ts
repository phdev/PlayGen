import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from 'playwright';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { installVirtualGamepad } from './inputs/gamepad.js';
import type { InputMode } from '../types/manifest.js';
import type { PlayGenState } from '../types/playgen.js';

export interface LaunchOptions {
  url: string;
  inputMode: InputMode;
  headless?: boolean;
  viewport?: { width: number; height: number };
  screenshotDir?: string;
}

export interface HarnessSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  inputMode: InputMode;
  screenshotDir?: string;
  screenshotIndex: number;
  close: () => Promise<void>;
}

const HEADLESS_DEFAULT =
  (process.env.PLAYWRIGHT_HEADLESS ?? 'true') !== 'false';

const MOBILE_VIEWPORT = { width: 412, height: 915 };
const DESKTOP_VIEWPORT = { width: 1280, height: 720 };

export async function launchHarness(
  opts: LaunchOptions,
): Promise<HarnessSession> {
  const headless = opts.headless ?? HEADLESS_DEFAULT;
  const viewport =
    opts.viewport ??
    (opts.inputMode === 'touch' ? MOBILE_VIEWPORT : DESKTOP_VIEWPORT);

  const browser = await chromium.launch({
    headless,
    channel: 'chromium',
    args: ['--use-gl=angle', '--ignore-gpu-blocklist', '--enable-webgl'],
  });

  const context = await browser.newContext({
    viewport,
    hasTouch: opts.inputMode === 'touch',
    isMobile: opts.inputMode === 'touch',
    deviceScaleFactor: opts.inputMode === 'touch' ? 2 : 1,
  });

  const page = await context.newPage();
  if (opts.inputMode === 'gamepad') {
    await installVirtualGamepad(page);
  }

  const session: HarnessSession = {
    browser,
    context,
    page,
    inputMode: opts.inputMode,
    screenshotDir: opts.screenshotDir,
    screenshotIndex: 0,
    close: async () => {
      await context.close().catch(() => undefined);
      await browser.close().catch(() => undefined);
    },
  };

  await page.goto(opts.url, { waitUntil: 'load' });
  return session;
}

export async function snapshot(
  session: HarnessSession,
  label: string,
): Promise<string | undefined> {
  if (!session.screenshotDir) return undefined;
  await fs.mkdir(session.screenshotDir, { recursive: true });
  const idx = String(session.screenshotIndex++).padStart(3, '0');
  const fileName = `${idx}-${session.inputMode}-${label}.png`;
  const target = path.join(session.screenshotDir, fileName);
  await session.page.screenshot({ path: target, fullPage: false });
  return target;
}

export async function readPlayGenState(
  session: HarnessSession,
): Promise<PlayGenState | null> {
  return session.page.evaluate<PlayGenState | null>(() => {
    const w = window as unknown as { __playgen?: PlayGenState };
    return w.__playgen ?? null;
  });
}

export async function waitForReady(
  session: HarnessSession,
  timeoutMs = 30_000,
): Promise<void> {
  await session.page.waitForFunction(
    () => {
      const w = window as unknown as { __playgen?: { ready?: boolean } };
      return w.__playgen?.ready === true;
    },
    null,
    { timeout: timeoutMs },
  );
}
