// Playwright recipe — Death workflow walkthrough on the Wayly mobile web build.
//
// Run this from a teammate's machine where headed Playwright can hand control
// off to a screen recorder. The pod cannot record video.
//
// Prereqs:
//   npm i -D @playwright/test
//   npx playwright install chromium
//
// Then capture a video via the built-in `--video=on` option:
//   npx playwright test scripts/scenario-death-walkthrough.spec.ts \
//       --headed --video=on --workers=1
//
// The MP4 lands in `test-results/.../video.webm`. Convert to MP4 with ffmpeg.

import { test, expect } from '@playwright/test';

const BASE = process.env.WAYLY_PREVIEW || 'https://aged-care-os.preview.emergentagent.com';
const EMAIL = process.env.WAYLY_EMAIL || 'cathy@example.com';
const PASS  = process.env.WAYLY_PASS  || 'testpass123';

test.use({
  viewport: { width: 390, height: 844 },          // iPhone 14 Pro
  deviceScaleFactor: 3,
  hasTouch: true,
});

test('Death workflow — end-to-end', async ({ page }) => {
  test.setTimeout(120_000);

  // 1. Login
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.fill('input[type=email]', EMAIL);
  await page.fill('input[type=password]', PASS);
  await page.getByText(/^Sign in$/i).click({ force: true });
  await page.waitForURL(/today|tabs/, { timeout: 30_000 });

  // 2. Switch to Patricia (or any participant) via the header pill
  const pill = page.getByTestId('participant-switcher-trigger');
  await pill.click();
  await page.getByText(/Patricia/i).click({ force: true });
  await page.waitForTimeout(800);

  // 3. Navigate: More → Guided workflows
  await page.goto(`${BASE}/workflows`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);

  // 4. Open Death workflow (testID set on each row)
  await page.getByTestId('workflow-link-death').click({ force: true });
  await page.waitForTimeout(900);

  // 5. ContactCard must render with ESCALATE styling (clay-red border)
  await expect(page.getByTestId('contact-card')).toBeVisible();
  // At least one tel button must be present (sourced from schema, never hard-coded).
  await expect(page.getByTestId(/contact-call-/).first()).toBeVisible();

  // 6. Step through the wizard. Each step ends with `workflow-death-continue`.
  for (let i = 0; i < 6; i += 1) {
    const cont = page.getByTestId('workflow-death-continue');
    if (await cont.count() === 0) break;
    await cont.first().click({ force: true });
    await page.waitForTimeout(700);
    // If the wizard exited to the timeline, we're done.
    if (page.url().includes('/timeline')) break;
  }

  // 7. Land on Timeline — the wizard's exit destination.
  await expect(page).toHaveURL(/timeline/);

  // 8. Hold the final frame so the recorder catches the destination.
  await page.waitForTimeout(1500);
});
