import type { Page } from 'playwright';

export async function tapKey(page: Page, key: string): Promise<void> {
  await page.keyboard.press(key);
}

export async function holdKey(
  page: Page,
  key: string,
  durationMs: number,
): Promise<void> {
  await page.keyboard.down(key);
  await page.waitForTimeout(durationMs);
  await page.keyboard.up(key);
}

export async function chord(
  page: Page,
  keys: string[],
  durationMs = 50,
): Promise<void> {
  for (const k of keys) await page.keyboard.down(k);
  await page.waitForTimeout(durationMs);
  for (const k of keys.slice().reverse()) await page.keyboard.up(k);
}
