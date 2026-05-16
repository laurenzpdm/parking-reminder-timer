import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from 'playwright';

const appUrl = process.env.APP_URL;

test('web app starts a parking session and opens the paywall', { skip: !appUrl }, async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });

  try {
    await page.goto(appUrl!, { waitUntil: 'networkidle' });
    await assertText(page, 'Never miss a meter again');
    await page.getByLabel('Parking duration minutes').fill('45');
    await page.getByRole('button', { name: 'Start parking timer' }).click();
    await assertText(page, 'Time left');
    await assertText(page, 'Saved spot');
    await page.getByText('Unlock Pro').click();
    await assertText(page, 'Parking Pro');
    await assertText(page, '7-day free trial');
    await assertText(page, '$4.99 / week');
    await page.getByLabel('Free trial').click();
    await assertText(page, 'Annual selected at the lowest yearly price');
    await assertText(page, '$19.99 / year');
    await assertText(page, 'Continue annual');
    await page.screenshot({ path: 'artifacts/browser-smoke.png', fullPage: true });
  } finally {
    await browser.close();
  }
});

async function assertText(page: import('playwright').Page, text: string) {
  await page.getByText(text, { exact: false }).first().waitFor({ timeout: 10_000 });
  assert.ok(await page.getByText(text, { exact: false }).first().isVisible());
}
