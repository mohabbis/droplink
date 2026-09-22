import { createHash, randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { expect, test, type Browser, type Page } from '@playwright/test';

async function twoDevices(browser: Browser): Promise<[Page, Page]> {
  // Separate contexts = separate browser sessions with no shared storage.
  const a = await (await browser.newContext()).newPage();
  const b = await (await browser.newContext()).newPage();
  return [a, b];
}

async function pair(a: Page, b: Page): Promise<string> {
  await a.goto('/');
  await a.getByRole('button', { name: 'Create a pairing code' }).click();
  const code = (await a.locator('.code-display').textContent())!.replace('-', '');
  expect(code).toMatch(/^[2-9A-Z]{6}$/);

  await b.goto(`/#join=${code}`);
  await expect(a.getByRole('heading', { name: 'Confirm it’s the right device' })).toBeVisible();
  await expect(b.getByRole('heading', { name: 'Confirm it’s the right device' })).toBeVisible();

  // Both devices must show the same verification code.
  await expect(a.locator('.sas')).toHaveText(/^\d{3} \d{3}$/);
  const sasA = await a.locator('.sas').textContent();
  await expect(b.locator('.sas')).toHaveText(sasA!);

  await a.getByRole('button', { name: 'Codes match' }).click();
  await expect(a.getByText('Waiting for the other device to confirm')).toBeVisible();
  await b.getByRole('button', { name: 'Codes match' }).click();
  await expect(a.getByText('Connected to')).toBeVisible();
  await expect(b.getByText('Connected to')).toBeVisible();
  return sasA!;
}

/** The visible transfer heading (a hidden live region repeats it for screen readers). */
const title = (p: Page, text: string | RegExp) => p.locator('.transfer__title', { hasText: text });

const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');

test('transfers files between two browser sessions and verifies them', async ({ browser }) => {
  const [a, b] = await twoDevices(browser);
  await pair(a, b);
  await expect(a.locator('.badge')).toHaveText('Direct connection');

  const big = randomBytes(25 * 1024 * 1024);
  const small = Buffer.from('hello from DropLink\n');
  await a.getByTestId('file-input').setInputFiles([
    { name: 'big.bin', mimeType: 'application/octet-stream', buffer: big },
    { name: 'note.txt', mimeType: 'text/plain', buffer: small },
  ]);
  await expect(a.getByText('2 files · 26.2 MB')).toBeVisible();
  await a.getByRole('button', { name: /^Send 26\.2 MB$/ }).click();
  await expect(title(a, /Waiting for .* to accept/)).toBeVisible();

  await expect(title(b, /wants to send you 2 files/)).toBeVisible();
  await b.getByRole('button', { name: 'Accept', exact: true }).click();

  await expect(title(b, 'Received 2 files')).toBeVisible({ timeout: 60_000 });
  await expect(title(a, 'Sent 2 files')).toBeVisible({ timeout: 60_000 });
  await expect(a.getByText('Delivered and verified')).toHaveCount(2);

  for (const [name, expected] of [
    ['big.bin', big],
    ['note.txt', small],
  ] as const) {
    const [download] = await Promise.all([
      b.waitForEvent('download'),
      b.getByRole('link', { name: `Download ${name}` }).click(),
    ]);
    expect(download.suggestedFilename()).toBe(name);
    const data = await readFile((await download.path())!);
    expect(data.length).toBe(expected.length);
    expect(sha256(data)).toBe(sha256(expected));
  }

  // Sending in the other direction works on the same connection.
  await b.getByTestId('file-input').setInputFiles([{ name: 'reply.txt', mimeType: 'text/plain', buffer: Buffer.from('ok') }]);
  await b.getByRole('button', { name: /^Send/ }).click();
  await a.getByRole('button', { name: 'Accept', exact: true }).click();
  await expect(title(a, 'Received 1 file')).toBeVisible();

  // When one side leaves, the other is told and keeps its received files.
  await a.close();
  await expect(b.getByText(/disconnected/)).toBeVisible({ timeout: 20_000 });
  await expect(b.getByRole('link', { name: 'Download big.bin' })).toBeVisible();
});

test('receiver can decline, and sender can cancel mid-transfer', async ({ browser }, testInfo) => {
  const [a, b] = await twoDevices(browser);
  await pair(a, b);

  await a.getByTestId('file-input').setInputFiles([{ name: 'x.bin', mimeType: 'application/octet-stream', buffer: randomBytes(1024) }]);
  await a.getByRole('button', { name: /^Send/ }).click();
  await b.getByRole('button', { name: 'Decline' }).click();
  await expect(title(a, /declined/)).toBeVisible();
  await expect(title(b, 'You declined')).toBeVisible();

  await a.getByRole('button', { name: 'Clear', exact: true }).click();
  const huge = testInfo.outputPath('huge.bin');
  await writeFile(huge, randomBytes(300 * 1024 * 1024));
  await a.getByTestId('file-input').setInputFiles(huge);
  await a.getByRole('button', { name: /^Send/ }).click();
  await b.getByRole('button', { name: 'Accept', exact: true }).click();
  await expect(a.locator('progress')).toBeVisible();
  await a.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(title(a, 'You cancelled the transfer')).toBeVisible();
  await expect(title(b, /cancelled the transfer/)).toBeVisible();
  // The connection survives a cancelled transfer.
  await expect(b.getByText('Connected to')).toBeVisible();
});

test('shows useful errors for bad and unknown codes', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Enter a code from another device').fill('abc');
  await page.getByRole('button', { name: 'Join' }).click();
  await expect(page.getByRole('alert')).toContainText('Enter the 6-character code');

  await page.getByLabel('Enter a code from another device').fill('222-222');
  await page.getByRole('button', { name: 'Join' }).click();
  await expect(page.getByRole('heading', { name: 'We couldn’t find that code' })).toBeVisible();
  await page.getByRole('button', { name: 'Start again' }).click();
  await expect(page.getByRole('button', { name: 'Create a pairing code' })).toBeVisible();
});

test('rejecting the verification code ends the pairing on both devices', async ({ browser }) => {
  const [a, b] = await twoDevices(browser);
  await a.goto('/');
  await a.getByRole('button', { name: 'Create a pairing code' }).click();
  const code = (await a.locator('.code-display').textContent())!;
  await b.goto('/');
  await b.getByLabel('Enter a code from another device').fill(code);
  await b.getByRole('button', { name: 'Join' }).click();
  await expect(b.locator('.sas')).toHaveText(/^\d{3} \d{3}$/);
  await b.getByRole('button', { name: 'They don’t match' }).click();
  await expect(b.getByRole('heading', { name: 'Pairing cancelled' })).toBeVisible();
  await expect(a.getByRole('heading', { name: 'The other device left' })).toBeVisible({ timeout: 20_000 });
});
