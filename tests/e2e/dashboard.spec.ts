import { expect, test, type Page } from '@playwright/test';

// Runs against the production build serving the real pipeline output (public/data).

async function ready(page: Page) {
  await page.goto('/');
  await expect(page.locator('.map[data-ready="true"]')).toBeVisible();
  // wait until county tiles have rendered
  await page.waitForFunction(() => document.querySelector('.maplibregl-canvas') !== null);
  await page.waitForTimeout(1500);
}

test('header shows reporting period, source and coverage', async ({ page }) => {
  await ready(page);
  const meta = await (await page.request.get('/data/meta.json')).json();
  await expect(page.getByRole('heading', { name: 'U.S. Residential Building Permits' })).toBeVisible();
  await expect(page.locator('.facts')).toContainText('Data through');
  await expect(page.locator('.facts')).toContainText('U.S. Census Bureau');
  await expect(page.locator('.facts')).toContainText(`Vintage ${meta.population.vintage}`);
  await expect(page.locator('.facts')).toContainText(`of ${meta.geography.universe.toLocaleString('en-US')}`);
  await expect(page.locator('body')).not.toContainText('Housing Starts Dashboard');
});

test('metric toggle recolors the map without reloading', async ({ page }) => {
  await ready(page);
  // A marker on window survives only if the page is never reloaded.
  await page.evaluate(() => { (window as unknown as { __noReload: boolean }).__noReload = true; });
  const legend = page.locator('.legend-title');
  await expect(legend).toContainText('housing units authorized');
  const first = await page.locator('.legend-classes').innerText();
  await page.getByRole('radio', { name: 'YoY Growth' }).click();
  await expect(legend).toContainText('Change in housing units');
  await expect(page.locator('.legend-special')).toContainText('Below minimum prior volume');
  await page.getByRole('radio', { name: 'Permits / 1,000 Residents' }).click();
  await expect(legend).toContainText('per 1,000 residents');
  expect(await page.locator('.legend-classes').innerText()).not.toEqual(first);
  expect(await page.evaluate(() => (window as unknown as { __noReload?: boolean }).__noReload)).toBe(true);
  // legend counts cover every county in the universe
  const counts = await page.locator('.legend .cnt').allInnerTexts();
  const sum = counts.map((t) => Number(t.replace(/,/g, ''))).reduce((a, b) => a + b, 0);
  const meta = await (await page.request.get('/data/meta.json')).json();
  expect(sum).toBe(meta.geography.universe);
});

test('search, select a county, and see its actual values', async ({ page }) => {
  await ready(page);
  const metrics = await (await page.request.get('/data/metrics.json')).json();
  const i = metrics.geoid.indexOf('48453'); // Travis County, TX
  const units = metrics.ttm.cur_total[i];
  await page.getByLabel('Search counties and states').fill('Travis');
  await page.getByRole('option', { name: /Travis County, TX/ }).click();
  const panel = page.locator('aside.panel');
  await expect(panel.getByRole('heading', { name: 'Travis County' })).toBeVisible();
  await expect(panel).toContainText('FIPS 48453');
  await expect(panel.locator('.kpi').first()).toContainText(units.toLocaleString('en-US'));
  await expect(panel).toContainText('Construction breakdown');
  await expect(panel.locator('figure').first()).toBeVisible();
  await page.getByRole('button', { name: 'Reset view' }).click();
});

test('clicking the map opens a county; table row selects; CSV exports', async ({ page }) => {
  await ready(page);
  const box = await page.locator('.map').boundingBox();
  await page.mouse.move(box!.x + box!.width * 0.55, box!.y + box!.height * 0.45);
  await expect(page.locator('.tooltip')).toBeVisible();
  await page.mouse.click(box!.x + box!.width * 0.55, box!.y + box!.height * 0.45);
  await expect(page.locator('aside.panel h2')).not.toHaveText('United States');
  await page.locator('.rankings tbody tr').first().click();
  await expect(page.locator('.rankings tbody tr.sel')).toHaveCount(1);
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export CSV' }).click()]);
  expect(download.suggestedFilename()).toMatch(/^building-permits-ttm-all-\d{4}-\d{2}\.csv$/);
});

test('missing-data counties are distinguished and methodology explains coverage', async ({ page }) => {
  await ready(page);
  await expect(page.locator('.legend-special')).toContainText('No BPS county data');
  await page.getByRole('button', { name: 'Coverage & methodology' }).click();
  const dlg = page.getByRole('dialog');
  await expect(dlg).toContainText('can a comparable 12-month figure be produced for every county?');
  await expect(dlg).toContainText('Building permits versus housing starts');
  await expect(dlg).toContainText('Automated validation');
});

test('calendar-year view and comparison', async ({ page }) => {
  await ready(page);
  await page.getByRole('radio', { name: /final annual/ }).click();
  await expect(page.locator('.banner')).toContainText('finalized annual county file');
  const boxes = page.locator('.rankings tbody input[type=checkbox]');
  await boxes.nth(0).check();
  await boxes.nth(1).check();
  await expect(page.locator('section.compare tbody tr')).toHaveCount(2);
});
