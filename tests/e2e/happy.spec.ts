import { expect, test, type Page } from '@playwright/test';
import { hostCall, hostClient, openPlay } from '../helpers/player';

const KEY = 'e2e-key';

async function host(baseURL: string) {
  const h = hostClient(baseURL, KEY);
  await new Promise<void>((res, rej) => (h.once('connect', () => res()), h.once('connect_error', rej)));
  return h;
}

async function tapChanged(page: Page) {
  const board = page.locator('.board[data-phase="test"]');
  await board.waitFor({ timeout: 15_000 });
  await board.locator('[data-changed="1"]').click();
}

test('participant happy path with host release and export', async ({ page, baseURL }) => {
  const h = await host(baseURL!);
  const created = await hostCall<{ session: { id: string; code: string } }>(h, 'create', { label: 'e2e', mode: 'test' });
  expect(created.ok).toBe(true);
  if (!created.ok) return;
  const { id, code } = created.session;
  const lease = 'lease-happy001';
  expect((await openPlay(h, id, lease)).ok).toBe(true);
  expect((await hostCall(h, 'bots.spawn', { sessionId: id, n: 12, meanScore: 650, sd: 120 })).ok).toBe(true);
  expect((await hostCall(h, 'bots.advance', { sessionId: id, to: 'rated_before' })).ok).toBe(true);

  await page.goto(`/${code}`);
  const codename = await page.getByTestId('codename').textContent();
  expect(codename).toMatch(/^[A-Z]+ [A-Z]+$/);
  await page.getByRole('button', { name: /Start/ }).click();

  const go = page.getByTestId('go');
  while (!(await go.isVisible())) {
    await tapChanged(page).catch(() => {});
  }
  await go.click();

  const score = page.getByTestId('score');
  for (let i = 0; i < 12; i++) await tapChanged(page);
  await expect(score).toBeVisible({ timeout: 20_000 });

  await page.reload();
  await expect(page.getByTestId('score')).toBeVisible();
  const text = (await score.getAttribute('aria-label'))!;
  const my = Number(text.replace(/\D/g, ''));
  expect(my).toBeGreaterThanOrEqual(900);
  const body = await page.locator('body').innerText();
  expect(body).not.toMatch(/12\s*\/\s*12|%|rank/i);

  await page.getByRole('button', { name: /Continue/ }).click();
  await expect(page.getByText('How well do you think you performed?')).toBeVisible();
  await page.getByTestId('fader').click();
  await page.getByTestId('lock').click();
  await expect(page.getByTestId('calibrating')).toBeVisible();

  const rel = await hostCall<{ released: number }>(h, 'release', { sessionId: id });
  expect(rel.ok).toBe(true);
  await expect(page.getByTestId('recap')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('station-2')).toBeAttached({ timeout: 10_000 });
  await expect(page.locator('.others li')).toHaveCount(3);
  const recapText = await page.getByTestId('recap').innerText();
  expect(recapText).not.toMatch(/ghost|condition|upward|downward/i);
  await expect(page.getByTestId('recap-continue')).toBeEnabled({ timeout: 10_000 });
  await page.getByTestId('recap-continue').click();

  await expect(page.getByText('How well do you think you performed?')).toBeVisible();
  await page.getByTestId('fader').click();
  await page.getByTestId('lock').click();
  await expect(page.getByTestId('done')).toBeVisible();

  expect((await hostCall(h, 'bots.advance', { sessionId: id, to: 'done' })).ok).toBe(true);
  let rev = (await hostCall<{ view: { rev: number } }>(h, 'pres.open', { sessionId: id, leaseId: lease })).view.rev;
  const pres = async (c: Record<string, unknown>) => {
    const r = await hostCall<{ view: { rev: number } }>(h, 'pres.cmd', { sessionId: id, leaseId: lease, cmd: { ...c, rev } });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    rev = r.view.rev;
  };
  await pres({ t: 'begin', confirm: 'BEGIN' });
  await pres({ t: 'goto', scene: 'felt', beat: 0 });
  await expect(page.getByTestId('prompt')).toHaveAttribute('data-prompt', 'felt');
  await expect(page.getByTestId('prompt-send')).toBeDisabled();
  await page.getByTestId('choice-little').click();
  await page.getByTestId('prompt-send').click();
  await expect(page.getByTestId('done')).toBeVisible();
  await pres({ t: 'goto', scene: 'switch', beat: 0 });
  await expect(page.getByTestId('prompt')).toHaveAttribute('data-prompt', 'switch');
  const sliders = page.getByTestId('p-slider');
  await expect(sliders).toHaveCount(3);
  for (let i = 0; i < 3; i++) {
    await sliders.nth(i).focus();
    await page.keyboard.press('ArrowRight');
  }
  await page.getByTestId('prompt-send').click();
  await expect(page.getByTestId('done')).toBeVisible();
  await pres({ t: 'goto', scene: 'mirrors', beat: 1 });
  await page.getByTestId('prompt-send').click();
  await expect(page.getByTestId('done')).toBeVisible();
  const phone = await page.locator('body').innerText();
  expect(phone).not.toMatch(/ghost|condition|upward|downward|stratum/i);
  await pres({ t: 'goto', scene: 'end', beat: 0 });

  const res = await fetch(`${baseURL}/api/export/${id}`, { headers: { 'x-admin-key': KEY } });
  expect(res.status).toBe(200);
  const data = (await res.json()) as { participants: { codename: string; kind: string }[] };
  expect(data.participants.some((p) => p.codename === codename && p.kind === 'human')).toBe(true);
  h.close();
});

test('unknown room shows a friendly error', async ({ page }) => {
  await page.goto('/ZZZZ');
  await expect(page.getByText('No such room.')).toBeVisible();
});
