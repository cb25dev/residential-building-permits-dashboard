// Ad-hoc visual check: node tests/e2e/screens.mjs <outdir>  (expects `npm run preview` running)
import { chromium } from '@playwright/test';
const out = process.argv[2];
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
const go = async (hash = '') => { await p.goto('http://localhost:4173/' + hash); await p.waitForSelector('.map[data-ready="true"]'); await p.waitForTimeout(2500); };
await go('#metric=abs'); await p.screenshot({ path: `${out}/1-abs.png` });
await go('#metric=yoy'); await p.screenshot({ path: `${out}/2-yoy.png` });
await go('#metric=per'); await p.screenshot({ path: `${out}/3-per.png` });
await go('#metric=abs&county=48453'); await p.waitForTimeout(2000); await p.screenshot({ path: `${out}/4-county.png`, fullPage: false });
await p.locator('aside.panel').screenshot({ path: `${out}/5-panel.png` });
await go('#metric=yoy&state=12'); await p.screenshot({ path: `${out}/6-state.png`, fullPage: true });
await b.close();
