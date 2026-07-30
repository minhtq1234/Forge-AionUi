/**
 * Creative Studio persistence and fake-provider generation coverage.
 *
 * Run with:
 * AIONUI_E2E_TEST=1 AIONUI_E2E_STUDIO_FAKE=1 E2E_DEV=1 \
 *   bunx playwright test --config playwright.config.ts \
 *   tests/e2e/features/workspaces/creative-studio.e2e.ts
 */
import { expect, test } from '../../fixtures';
import { navigateTo, ROUTES } from '../../helpers';
import path from 'node:path';

test.describe('Creative Studio workspace', () => {
  test.skip(
    process.env.AIONUI_E2E_TEST !== '1' || process.env.AIONUI_E2E_STUDIO_FAKE !== '1' || process.env.E2E_DEV !== '1',
    'Creative Studio E2E requires both fake-provider flags and an explicit unpackaged dev launch.'
  );

  test('persists a project across reload and cancels a fake queued generation job', async ({ electronApp, page }) => {
    const projectName = `Studio E2E ${Date.now()}`;

    await test.step('prove the fake-provider runtime gate is active', async () => {
      const gate = await electronApp.evaluate(({ app }) => ({
        isPackaged: app.isPackaged,
        testMode: process.env.AIONUI_E2E_TEST,
        studioFake: process.env.AIONUI_E2E_STUDIO_FAKE,
        expectedUserDataPath: process.env.AIONUI_E2E_USER_DATA_DIR,
        userDataPath: app.getPath('userData'),
      }));
      expect(gate).toMatchObject({
        isPackaged: false,
        testMode: '1',
        studioFake: '1',
      });
      expect(gate.expectedUserDataPath).toBeTruthy();
      expect(gate.userDataPath).toBe(gate.expectedUserDataPath);

      const systemInfo = await electronApp.evaluate(async () => {
        const port = (globalThis as typeof globalThis & { __backendPort?: number }).__backendPort;
        if (!port) throw new Error('Studio E2E backend port was not published');
        const response = await fetch(`http://127.0.0.1:${port}/api/system/info`);
        if (!response.ok) throw new Error(`Studio E2E system info failed with ${response.status}`);
        const body = (await response.json()) as {
          data?: { cache_dir: string; work_dir: string };
          cache_dir?: string;
          work_dir?: string;
        };
        const data = body.data ?? body;
        return { cacheDir: data.cache_dir, workDir: data.work_dir };
      });
      expect(systemInfo).toEqual({
        cacheDir: path.join(gate.userDataPath, 'config'),
        workDir: path.join(gate.userDataPath, 'aionui'),
      });
    });

    await test.step('create a project through the Studio library', async () => {
      await navigateTo(page, ROUTES.studio);
      const studioLibrary = page.getByRole('region', { name: 'Creative Studio' });
      await expect(studioLibrary).toBeVisible();

      await studioLibrary.getByRole('button', { name: 'New project' }).click();
      const createDialog = page.getByRole('dialog', { name: 'Create a Creative Studio project' });
      await expect(createDialog).toBeVisible();
      await createDialog.getByLabel('Project name').fill(projectName);
      await createDialog
        .getByLabel('Creative brief')
        .fill('A deterministic E2E story used to verify local Studio persistence and safe job cancellation.');
      await createDialog.getByLabel('Target length in seconds').fill('5');
      await createDialog.getByRole('button', { name: 'Create project' }).click();

      await expect(page.getByRole('region', { name: 'Project overview' })).toBeVisible();
      await expect(page.getByRole('heading', { level: 1, name: projectName })).toBeVisible();
      await expect(page).toHaveURL(/#\/studio\/[A-Za-z0-9_-]+$/);
    });

    await test.step('reload the renderer and recover the durable project', async () => {
      const projectUrl = page.url();
      await page.reload({ waitUntil: 'domcontentloaded' });

      await expect(page).toHaveURL(projectUrl);
      await expect(page.getByRole('region', { name: 'Project overview' })).toBeVisible();
      await expect(page.getByRole('heading', { level: 1, name: projectName })).toBeVisible();
    });

    await test.step('submit through the fake route and cancel while remotely queued', async () => {
      await page.getByRole('button', { name: 'Add scene' }).click();
      await expect(page.getByLabel('Visual prompt')).toBeVisible();

      const outputType = page.getByLabel('Output type');
      await outputType.click();
      await page
        .locator('.arco-select-option')
        .filter({ hasText: /^Video$/ })
        .click();

      const visualPrompt = page.getByLabel('Visual prompt');
      await visualPrompt.fill('A paper airplane crossing a calm blue studio backdrop.');
      await visualPrompt.blur();

      const routingRegion = page.getByRole('region', { name: 'Generation route' });
      await expect(routingRegion).toContainText('WePrompt Studio E2E');
      await expect(routingRegion).toContainText('weprompt-e2e-video');
      const fakeRouteOption = routingRegion.getByRole('radio', {
        name: 'WePrompt Studio E2E weprompt-media-gateway-v1 weprompt-e2e-video',
      });
      if ((await fakeRouteOption.count()) > 0) {
        await fakeRouteOption.click();
      }

      const generateScene = page.getByRole('button', { name: 'Generate scene' });
      await expect(generateScene).toBeEnabled();
      await generateScene.click();

      const reviewDialog = page.getByRole('dialog', { name: 'Review generation' });
      await expect(reviewDialog.getByText('weprompt_studio_e2e')).toBeVisible();
      await reviewDialog.getByRole('button', { name: 'Confirm and generate' }).click();

      await expect(page.getByText('Queued by provider')).toBeVisible({ timeout: 5_000 });
      await page.getByRole('button', { name: 'Cancel job' }).click();
      await expect(page.getByText('Cancelled')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Cancel job' })).toHaveCount(0);
    });
  });
});

test.describe('Creative Studio packaged workspace', () => {
  test.skip(
    process.env.E2E_PACKAGED !== '1' || process.env.AIONUI_E2E_STUDIO_FAKE !== '1',
    'Packaged Studio smoke requires an isolated E2E profile; the packaged runtime still refuses the fake adapter.'
  );

  test('creates and reloads a project without activating the fake provider', async ({ electronApp, page }) => {
    const projectName = `Packaged Studio ${Date.now()}`;
    const gate = await electronApp.evaluate(({ app }) => ({
      isPackaged: app.isPackaged,
      expectedUserDataPath: process.env.AIONUI_E2E_USER_DATA_DIR,
      userDataPath: app.getPath('userData'),
    }));
    expect(gate.isPackaged).toBe(true);
    expect(gate.expectedUserDataPath).toBeTruthy();
    expect(gate.userDataPath).toBe(gate.expectedUserDataPath);

    await navigateTo(page, ROUTES.studio);
    const studioLibrary = page.getByRole('region', { name: 'Creative Studio' });
    await expect(studioLibrary).toBeVisible();
    await studioLibrary.getByRole('button', { name: 'New project' }).click();

    const createDialog = page.getByRole('dialog', { name: 'Create a Creative Studio project' });
    await createDialog.getByLabel('Project name').fill(projectName);
    await createDialog.getByLabel('Creative brief').fill('A packaged-runtime persistence and security smoke.');
    await createDialog.getByLabel('Target length in seconds').fill('5');
    await createDialog.getByRole('button', { name: 'Create project' }).click();

    await expect(page.getByRole('heading', { level: 1, name: projectName })).toBeVisible();
    await expect(page.getByText('WePrompt Studio E2E')).toHaveCount(0);

    await page.getByRole('button', { name: 'Export assets' }).click();
    const exportDialog = page.getByRole('dialog', { name: 'Export assets' });
    await expect(exportDialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(exportDialog).toBeHidden();

    const projectUrl = page.url();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(projectUrl);
    await expect(page.getByRole('heading', { level: 1, name: projectName })).toBeVisible();
  });
});
