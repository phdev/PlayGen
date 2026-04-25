import type { Page } from 'playwright';

export interface ClickOptions {
  x: number;
  y: number;
  button?: 'left' | 'right' | 'middle';
  delay?: number;
}

export async function click(page: Page, opts: ClickOptions): Promise<void> {
  await page.mouse.click(opts.x, opts.y, {
    button: opts.button ?? 'left',
    delay: opts.delay,
  });
}

export async function moveTo(
  page: Page,
  x: number,
  y: number,
  steps = 8,
): Promise<void> {
  await page.mouse.move(x, y, { steps });
}

export async function dragFromTo(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  steps = 12,
): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps });
  await page.mouse.up();
}
