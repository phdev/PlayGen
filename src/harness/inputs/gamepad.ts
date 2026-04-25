import type { Page } from 'playwright';

export const STANDARD_BUTTONS = {
  A: 0, B: 1, X: 2, Y: 3,
  LB: 4, RB: 5, LT: 6, RT: 7,
  Back: 8, Start: 9,
  LS: 10, RS: 11,
  Up: 12, Down: 13, Left: 14, Right: 15,
  Home: 16,
} as const;

export const AXES = {
  LeftX: 0, LeftY: 1, RightX: 2, RightY: 3,
} as const;

export async function installVirtualGamepad(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const state = {
      buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
      axes: [0, 0, 0, 0] as number[],
      timestamp: 0,
    };
    (window as unknown as { __playgenGamepad: typeof state }).__playgenGamepad = state;

    const realGetGamepads = navigator.getGamepads.bind(navigator);
    navigator.getGamepads = () => {
      state.timestamp = performance.now();
      const fake = {
        id: 'PlayGen Virtual Gamepad (Vendor: 0000 Product: 0000)',
        index: 0,
        connected: true,
        timestamp: state.timestamp,
        mapping: 'standard' as GamepadMappingType,
        axes: state.axes.slice(),
        buttons: state.buttons.map((b) => ({
          pressed: b.pressed,
          touched: b.pressed,
          value: b.value,
        })),
        vibrationActuator: null,
        hapticActuators: [],
      } as unknown as Gamepad;
      const real = Array.from(realGetGamepads()).filter(Boolean) as Gamepad[];
      return [fake, ...real.slice(0, 3)] as (Gamepad | null)[];
    };

    queueMicrotask(() => {
      window.dispatchEvent(new Event('gamepadconnected'));
    });
  });
}

export async function pressButton(page: Page, index: number, value = 1): Promise<void> {
  await page.evaluate(([i, v]) => {
    const s = (window as unknown as { __playgenGamepad?: { buttons: { pressed: boolean; value: number }[] } }).__playgenGamepad;
    if (!s) throw new Error('virtual gamepad not installed');
    s.buttons[i] = { pressed: true, value: v };
  }, [index, value] as const);
}

export async function releaseButton(page: Page, index: number): Promise<void> {
  await page.evaluate((i) => {
    const s = (window as unknown as { __playgenGamepad?: { buttons: { pressed: boolean; value: number }[] } }).__playgenGamepad;
    if (!s) throw new Error('virtual gamepad not installed');
    s.buttons[i] = { pressed: false, value: 0 };
  }, index);
}

export async function setAxis(page: Page, axis: number, value: number): Promise<void> {
  await page.evaluate(([a, v]) => {
    const s = (window as unknown as { __playgenGamepad?: { axes: number[] } }).__playgenGamepad;
    if (!s) throw new Error('virtual gamepad not installed');
    s.axes[a] = v;
  }, [axis, value] as const);
}

export async function tap(page: Page, index: number, durationMs = 50): Promise<void> {
  await pressButton(page, index);
  await page.waitForTimeout(durationMs);
  await releaseButton(page, index);
}
