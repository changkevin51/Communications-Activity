import { expect, test, type Page } from '@playwright/test';
import type { Socket } from 'socket.io-client';
import { hostCall, hostClient } from '../helpers/player';
import type { PresenterView } from '../../src/shared/reveal';

const KEY = 'e2e-key';
const LEASE = 'lease-e2e00001';
const BAD = /\bNaN\b|undefined|\bnull\b|Infinity/;

async function host(baseURL: string) {
  const h = hostClient(baseURL, KEY);
  await new Promise<void>((res, rej) => (h.once('connect', () => res()), h.once('connect_error', rej)));
  return h;
}

async function setup(baseURL: string, label: string) {
  const h = await host(baseURL);
  const c = await hostCall<{ session: { id: string; code: string } }>(h, 'create', { label, mode: 'test' });
  const id = c.session.id;
  const open = await hostCall<{ view: PresenterView }>(h, 'pres.open', { sessionId: id, leaseId: LEASE });
  let view = open.view;
  const cmd = async (c: Record<string, unknown>) => {
    await new Promise((r) => setTimeout(r, 70));
    const r = await hostCall<{ view: PresenterView; changed: boolean }>(h, 'pres.cmd', { sessionId: id, leaseId: LEASE, cmd: { ...c, rev: view.rev } });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    view = r.view;
    return r;
  };
  return { h, id, code: c.session.code, key: open.view.screenKey, cmd, view: () => view };
}

async function settled(page: Page, v: PresenterView) {
  const stage = page.locator('.stage');
  await expect(stage).toHaveAttribute('data-scene', v.scene);
  await expect(stage).toHaveAttribute('data-beat', String(v.beat));
  await page.waitForFunction((rev) => (window as unknown as { __screen?: { state?: { rev: number } } }).__screen?.state?.rev === rev, v.rev);
}

async function sane(page: Page) {
  const text = await page.locator('.stage').innerText();
  expect(text).not.toMatch(BAD);
  const head = page.getByTestId('headline');
  if (await head.count()) expect((await head.innerText()).trim().length).toBeGreaterThan(0);
}

test.afterEach(async () => {});

test('walks every scene and beat of a rehearsal; reload restores; hold blacks out', async ({ page, baseURL }, info) => {
  const s = await setup(baseURL!, 'proj');
  await page.goto(`/screen/${s.code}#k=${encodeURIComponent(s.key)}`);
  await expect(page.locator('.stage')).toHaveAttribute('data-scene', 'lobby');
  await expect(page.getByTestId('room-code')).toHaveText(s.code);
  await expect(page.getByTestId('watermark')).toHaveText('TEST SESSION');
  expect(page.url()).not.toContain('#k=');

  await s.cmd({ t: 'demo', scenario: 'expected', n: 60, seed: 'e2e' });
  await s.cmd({ t: 'flag', key: 'landscape', on: true });
  await expect(page.getByTestId('watermark')).toHaveText('REHEARSAL · SYNTHETIC DATA');
  const seen: string[] = [];
  for (let i = 0; i < 120; i++) {
    const v = s.view();
    await settled(page, v);
    await sane(page);
    seen.push(`${v.scene}.${v.beat}`);
    if (info.project.name === 'projector-chromium') await page.waitForTimeout(1400), await page.screenshot({ path: `test-results/projector/${String(i).padStart(2, '0')}-${v.scene}-${v.beat}.png` });
    if (v.scene === 'movement' && v.beat === 1) {
      await page.reload();
      await settled(page, v);
    }
    const r = await s.cmd({ t: 'next' });
    if (!r.changed) break;
  }
  for (const sc of ['onegame', 'selfrating', 'cut', 'samescore', 'worlds', 'movement', 'compare', 'mechanism', 'bridge', 'felt', 'switch', 'landscape', 'mirrors', 'chooser', 'circle', 'end']) expect(seen.some((x) => x.startsWith(sc))).toBe(true);
  await s.cmd({ t: 'hold', on: true });
  await expect(page.getByTestId('hold')).toBeVisible();
  await s.cmd({ t: 'hold', on: false });
  await expect(page.getByTestId('hold')).toHaveCount(0);

  const frames = await page.evaluate(() => (window as unknown as { __screen: { frames: number[] } }).__screen.frames.slice(-120));
  const sorted = frames.slice().sort((a, b) => a - b);
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  info.annotations.push({ type: 'frame-p95-ms', description: String(Math.round(p95)) });
  if (info.project.name === 'projector-chromium') expect(p95).toBeLessThan(100);
  (s.h as Socket).close();
});

test('adaptive scenarios render without broken values in animated and plain mode', async ({ page, baseURL }) => {
  const s = await setup(baseURL!, 'sweep');
  await page.goto(`/screen/${s.code}#k=${encodeURIComponent(s.key)}`);
  await expect(page.locator('.stage')).toHaveAttribute('data-scene', 'lobby');
  const profiles = ['expected', 'onesided', 'split', 'low', 'unexpected', 'optionalzero', 'expected'];
  for (const [k, scenario] of ['noisy', 'none', 'reversed', 'small', 'ties', 'imbalanced', 'lateheavy'].entries()) {
    await s.cmd({ t: 'demo', scenario, n: scenario === 'small' ? 6 : 40, seed: scenario, profile: profiles[k] });
    if (!s.view().flags.landscape) await s.cmd({ t: 'flag', key: 'landscape', on: true });
    for (const plain of [false, true]) {
      if (s.view().plain !== plain) await s.cmd({ t: 'plain', on: plain });
      for (const scene of ['onegame', 'selfrating', 'worlds', 'movement', 'compare', 'mechanism', 'felt', 'switch', 'landscape', 'mirrors', 'chooser', 'circle']) {
        await s.cmd({ t: 'goto', scene, beat: 9 });
        await settled(page, s.view());
        await sane(page);
      }
    }
    await s.cmd({ t: 'plain', on: false });
    await s.cmd({ t: 'rewind', confirm: 'REWIND' });
  }
  (s.h as Socket).close();
});

test('presenter console drives the projector with keyboard', async ({ page, context, baseURL }) => {
  const s = await setup(baseURL!, 'console');
  await s.cmd({ t: 'take' }).catch(() => {});
  await page.goto('/host');
  await page.getByLabel('Admin key').fill(KEY);
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.goto(`/host#present=${s.id}`);
  await expect(page.getByTestId('presenter')).toBeVisible();
  const proj = await context.newPage();
  await proj.goto(`/screen/${s.code}#k=${encodeURIComponent(s.key)}`);
  await expect(page.getByTestId('projectors')).toContainText('connected (1)');
  const take = page.getByRole('button', { name: 'Take control' });
  if (await take.isVisible()) await take.click();
  await page.getByTestId('rehearsal').getByRole('button', { name: 'Run rehearsal' }).click();
  await expect(proj.locator('.stage')).toHaveAttribute('data-scene', 'onegame');
  await page.keyboard.press('ArrowRight');
  await expect(proj.locator('.stage')).toHaveAttribute('data-beat', '1');
  await page.keyboard.press('Shift+ArrowRight');
  await expect(proj.locator('.stage')).toHaveAttribute('data-scene', 'selfrating');
  await page.keyboard.press('b');
  await expect(proj.getByTestId('hold')).toBeVisible();
  await page.keyboard.press('b');
  await expect(proj.getByTestId('hold')).toHaveCount(0);
  await page.keyboard.press('?');
  await expect(page.getByTestId('help')).toBeVisible();
  (s.h as Socket).close();
});
