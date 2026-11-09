import { chromium } from '@playwright/test';
import { existsSync } from 'node:fs';
import jsQR from 'jsqr';
import { PNG } from 'pngjs';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
const base = 'http://127.0.0.1:3100';
const server = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: '3100', SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '', ADMIN_TOKEN: '' }, stdio: 'pipe' });
await new Promise((resolve, reject) => { server.stdout.once('data', resolve); server.once('error', reject); server.once('exit', code => reject(new Error('Server exited: ' + code))); });
let browser;
const errors = [];
await mkdir('test-results', { recursive: true });
try {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined), args: ['--no-sandbox'], headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  // Advertising is external to the app and is excluded from deterministic tests.
  await context.route(/googlesyndication|doubleclick|googleads/, route => route.fulfill({ body: '' }));
  await context.route('https://example.com/**', route => route.fulfill({ contentType: 'text/html', body: '<h1>Destination reached</h1>' }));
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(base + '/#shortener');
  await page.locator('#storageNotice').filter({ hasText: 'Mode lokal' }).waitFor();
  assert.equal(await page.locator('#btnSaveSettingsDomain').isDisabled(),true);
  await page.fill('#quickUrlInput', 'example.com/path'); await page.fill('#quickSlugInput', 'promo-test'); await page.click('#btnQuickSubmit');
  await page.locator('.link-card').waitFor();
  assert.equal(await page.locator('#quickResultUrl').getAttribute('href'), base + '/promo-test');
  await page.fill('#quickUrlInput', 'https://example.com/other'); await page.fill('#quickSlugInput', 'promo-test'); await page.click('#btnQuickSubmit');
  await page.locator('.toast').filter({hasText:'sudah digunakan'}).waitFor(); assert.equal(await page.locator('.link-card').count(),1);
  await page.click('#btnEditPreviewQuickResult');
  await page.fill('#modalOgTitle', 'Promo mobile & desktop');
  await page.click('.advanced-options summary');
  await page.fill('#modalPassword', ' 1234 '); await page.fill('#modalTags', 'bisnis, promo'); await page.fill('#utmSource','instagram');
  await page.setInputFiles('#modalFileInput', { name:'preview.png', mimeType:'image/png', buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5FoAAAAASUVORK5CYII=','base64') });
  await page.waitForFunction(() => document.getElementById('modalOgImage').value.startsWith('data:image/png'));
  await page.click('#btnSaveModalLink'); await page.locator('#modalLink').waitFor({state:'hidden'});
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('autoshort_links'))[0]);
  assert.equal(new URL(saved.destination_url).searchParams.get('utm_source'),'instagram'); assert.equal(saved.tags.length,2);
  await page.fill('#searchInput','nonesuch'); assert.equal(await page.locator('.link-card').count(),0);
  await page.fill('#searchInput','bisnis'); assert.equal(await page.locator('.link-card').count(),1);
  // Password gate and tracking only after successful unlock.
  const visitor = await context.newPage(); visitor.on('pageerror', e => errors.push(e.message));
  await visitor.goto(base + '/promo-test?src=qr'); await visitor.locator('#stateProtected').waitFor({state:'visible'});
  await visitor.fill('#passwordInput','wrong'); await visitor.click('#btnSubmitPassword'); await visitor.locator('#passwordError').waitFor({state:'visible'});
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('autoshort_clicks') || '[]').length),0);
  await visitor.fill('#passwordInput',' 1234 '); await visitor.click('#btnSubmitPassword'); await visitor.waitForURL('https://example.com/**');
  assert.equal((await page.evaluate(() => JSON.parse(localStorage.getItem('autoshort_clicks'))))[0].is_qr,true);
  await visitor.close();
  await page.click('.btn-pause-action'); await page.locator('.status-paused').waitFor();
  const paused = await context.newPage(); await paused.goto(base + '/promo-test'); await paused.locator('#statePaused').waitFor({state:'visible'}); await paused.close();
  await page.click('.btn-pause-action'); await page.locator('.status-protected').waitFor();
  // QR output has the selected pixel dimensions and no CDN dependency.
  await page.click('.btn-qr-action'); await page.locator('#qrStudioBox canvas').waitFor();
  await page.selectOption('#qrResolution','2048');
  const downloadPromise = page.waitForEvent('download'); await page.click('#btnDownloadStudioQr'); const download=await downloadPromise;
  const png=await readFile(await download.path()); assert.equal(png.readUInt32BE(16),2048); assert.equal(png.readUInt32BE(20),2048);
  const decoded = PNG.sync.read(png);
  assert.equal(jsQR(new Uint8ClampedArray(decoded.data), decoded.width, decoded.height).data, base + '/promo-test?src=qr');
  await page.selectOption('#qrResolution','512');
  await page.evaluate(() => document.getElementById('toastContainer').replaceChildren());
  // Every view must fit both desktop and phone widths, including a 320 px screen.
  for (const width of [1440,768,390,320]) {
    await page.setViewportSize({width,height:900});
    for (const view of ['analytics','shortener','qr-studio','activity','settings']) {
      await page.goto(base + '/#' + view);
      await page.waitForTimeout(80);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
      assert.equal(overflow,false,`Horizontal overflow: ${view} at ${width}`);
      await page.screenshot({path:`test-results/${view}-${width}.png`,fullPage:true});
    }
  }
  await page.setViewportSize({width:390,height:844}); await page.goto(base + '/#shortener');
  await page.click('#btnMobileMenuToggle'); await page.locator('#menuBackdrop').waitFor({state:'visible'});
  await page.click('#sidebarNavAnalytics .nav-link'); assert.equal(await page.locator('#menuBackdrop').isVisible(),false);
  await page.click('#btnDateRangeDropdown'); await page.click('.cal-preset-btn[data-preset="1"]');
  assert.equal(await page.locator('.chart-bar-column').count(),1);
  await page.click('#btnDateRangeDropdown'); await page.click('.cal-preset-btn[data-preset="7"]');
  assert.equal(await page.locator('.chart-bar-column').count(),7);
  await page.goto(base + '/#shortener'); await page.click('#btnOpenCreateModal'); await page.fill('#modalDestUrl','example.com'); await page.fill('#modalSlug','new-mobile');
  await page.screenshot({path:'test-results/modal-mobile.png'}); await page.keyboard.press('Escape'); assert.equal(await page.locator('#modalLink').isVisible(),false);
  await page.goto(base + '/#analytics');
  await page.click('#btnDownloadCsv').catch(()=>{});
  // Backup and restore preserve data, and expiry blocks a visit without logging it.
  await page.goto(base + '/#settings');
  const backupPromise = page.waitForEvent('download'); await page.click('#btnExportJsonBackup'); const backupDownload = await backupPromise;
  const backup = await readFile(await backupDownload.path());
  page.on('dialog', dialog => dialog.accept());
  await page.click('#btnResetAllData');
  await page.setInputFiles('#inputImportBackup', { name:'backup.json',mimeType:'application/json',buffer:backup });
  await page.locator('.toast').filter({hasText:'Cadangan berhasil dipulihkan'}).waitFor();
  await page.goto(base + '/#shortener'); await page.click('.btn-edit-action');
  await page.fill('#modalExpires','2000-01-01T00:00'); await page.click('#btnSaveModalLink');
  await page.locator('.status-expired').waitFor();
  const expired = await context.newPage(); await expired.goto(base + '/promo-test'); await expired.locator('#stateExpired').waitFor({state:'visible'}); await expired.close();
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('autoshort_clicks')).length),1);
  // Theme persists across reload.
  await page.click('#btnMobileMenuToggle'); await page.click('#btnThemeToggle'); await page.reload(); assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
  assert.deepEqual(errors,[]);
  console.log('PASS: create/edit/search/upload/UTM/password/QR/pause/tracking/calendar/theme and 20 responsive views.');
  // Cloud mode uses API results, honors empty arrays, and never reports success after failed saves.
  const cloudContext = await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
  await cloudContext.route(/googlesyndication|doubleclick|googleads/, route => route.fulfill({body:''}));
  let cloudLinks = []; let failSave = false; let cloudDomain = 'short.example'; let domainFailure = false; let failLogin = false; let vercelConnected = false; let attachedDomains = [];
  await cloudContext.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/config') return route.fulfill({json:{configured:true,customDomain:cloudDomain}});
    if (url.pathname === '/api/domain-integration') {
      vercelConnected=route.request().method() !== 'DELETE';return route.fulfill({json:{connected:vercelConnected}});
    }
    if (url.pathname === '/api/domains') {
      const method=route.request().method();
      if(method==='GET')return route.fulfill({json:{connected:vercelConnected,customDomain:cloudDomain,domains:attachedDomains}});
      if(method==='DELETE'&&url.searchParams.has('domain')){attachedDomains=attachedDomains.filter(d=>d.name!==url.searchParams.get('domain'));return route.fulfill({json:{removed:url.searchParams.get('domain')}});}
      const input=route.request().postDataJSON()||{};
      if(input.action==='add'||input.action==='check'){
        if(input.action==='add')attachedDomains.push({name:input.domain,verified:false});
        return route.fulfill({json:{domain:{name:input.domain,verified:false,misconfigured:true,nameservers:['ns.provider.test'],dns:[{type:'CNAME',name:'go',value:'target.vercel-dns.example',purpose:'routing'}]}}});
      }
      if (domainFailure) return route.fulfill({status:422,json:{error:'DNS belum tersedia'}});
      cloudDomain = method === 'DELETE' ? '' : input.domain;
      return route.fulfill({json:{customDomain:cloudDomain,verified:true}});
    }
    if (failLogin && ['/api/links','/api/analytics'].includes(url.pathname)) return route.fulfill({status:401,json:{error:'Token admin diperlukan'}});
    if (url.pathname === '/api/analytics') return route.fulfill({json:{recentClicks:[]}});
    if (url.pathname === '/api/links') {
      if (route.request().method() === 'GET') return route.fulfill({json:{links:cloudLinks}});
      if (failSave) return route.fulfill({status:502,json:{error:'Database tidak tersedia'}});
      const input = route.request().postDataJSON() || {};
      const link = {...input,id:input.id||'cloud-one',created_at:new Date().toISOString(),clicks:0};
      if (route.request().method() === 'DELETE') cloudLinks=[];
      else cloudLinks=[link];
      return route.fulfill({json:{link,success:true}});
    }
    return route.continue();
  });
  const cloudPage=await cloudContext.newPage(); cloudPage.on('pageerror',e=>errors.push(e.message));
  await cloudPage.goto(base+'/#shortener'); await cloudPage.locator('#cloudStatusText').filter({hasText:'Cloud Terhubung'}).waitFor();
  await cloudPage.fill('#quickUrlInput','example.com'); await cloudPage.fill('#quickSlugInput','cloud-promo'); await cloudPage.click('#btnQuickSubmit');
  await cloudPage.locator('.link-card').waitFor(); assert.equal(await cloudPage.locator('#quickResultUrl').getAttribute('href'),'https://short.example/cloud-promo');
  assert.equal(await cloudPage.evaluate(()=>localStorage.getItem('autoshort_links')),null);
  failSave=true; await cloudPage.click('.btn-edit-action'); await cloudPage.fill('#modalOgTitle','Will fail'); await cloudPage.click('#btnSaveModalLink');
  await cloudPage.locator('.toast').filter({hasText:'Database tidak tersedia'}).waitFor(); assert.equal(await cloudPage.locator('#modalLink').isVisible(),true);
  await cloudPage.keyboard.press('Escape'); failSave=false;
  cloudPage.on('dialog', d=>d.accept()); await cloudPage.click('.btn-delete-action'); await cloudPage.locator('.link-card').waitFor({state:'hidden'});
  await cloudPage.goto(base+'/#analytics'); await cloudPage.click('#btnRefreshAnalytics'); assert.equal(await cloudPage.locator('#kpiTotalLinks').textContent(),'0');
  await cloudPage.goto(base+'/#settings');
  assert.equal(await cloudPage.locator('#btnImportBackup').isDisabled(),true);
  assert.equal(await cloudPage.locator('#btnResetAllData').isDisabled(),true);
  await cloudPage.fill('#inputVercelToken','test-vercel-secret');await cloudPage.click('#btnConnectVercel');
  await cloudPage.locator('#vercelIntegrationStatus').filter({hasText:'Vercel terhubung'}).waitFor();
  assert.equal(await cloudPage.locator('#inputVercelToken').inputValue(),'');
  await cloudPage.fill('#inputSettingsDomain','go.pending.example');await cloudPage.click('#btnAddDomain');
  await cloudPage.locator('#domainList').filter({hasText:'go.pending.example'}).waitFor();
  await cloudPage.locator('#domainDetails').filter({hasText:'target.vercel-dns.example'}).waitFor();
  await cloudPage.locator('#domainList').getByRole('button',{name:'Periksa DNS & HTTPS',exact:true}).click();
  await cloudPage.locator('#domainDetails').filter({hasText:'Verifikasi kepemilikan diperlukan'}).waitFor();
  await cloudPage.locator('#domainList').getByRole('button',{name:'Lepas Domain'}).click();
  await cloudPage.locator('#domainList .domain-item').waitFor({state:'hidden'});
  for(const width of [320,390,768,1440]){await cloudPage.setViewportSize({width,height:1000});assert.equal(await cloudPage.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'Domain settings overflow '+width);}
  domainFailure=true; await cloudPage.fill('#inputSettingsDomain','bad.example'); await cloudPage.click('#btnSaveSettingsDomain');
  await cloudPage.locator('#domainStatus').filter({hasText:'DNS belum tersedia'}).waitFor();
  assert.equal(await cloudPage.locator('#topDomainText').textContent(),'short.example');
  domainFailure=false; await cloudPage.fill('#inputSettingsDomain','go.example.com'); await cloudPage.click('#btnSaveSettingsDomain');
  await cloudPage.locator('#domainStatus').filter({hasText:'Aktif: go.example.com'}).waitFor();
  assert.equal(await cloudPage.locator('#topDomainText').textContent(),'go.example.com');
  await cloudPage.reload(); await cloudPage.locator('#topDomainText').filter({hasText:'go.example.com'}).waitFor();
  await cloudPage.click('#btnResetSettingsDomain'); await cloudPage.locator('#topDomainText').filter({hasText:'127.0.0.1:3100'}).waitFor();
  await cloudPage.evaluate(()=>sessionStorage.setItem('autoshort_admin_token','previous-token'));
  failLogin=true; await cloudPage.fill('#inputAdminToken','wrong-token'); await cloudPage.click('#btnSaveAdminToken');
  await cloudPage.locator('#adminSessionStatus').filter({hasText:'Token admin diperlukan'}).waitFor();
  assert.equal(await cloudPage.evaluate(()=>sessionStorage.getItem('autoshort_admin_token')),'previous-token');
  failLogin=false;
  await cloudPage.fill('#inputAdminToken','session-token'); await cloudPage.click('#btnSaveAdminToken');
  await cloudPage.locator('#adminSessionStatus').filter({hasText:'Sesi admin aktif'}).waitFor();
  await cloudPage.click('#btnLogoutAdmin'); assert.equal(await cloudPage.evaluate(()=>sessionStorage.getItem('autoshort_admin_token')),null);
  assert.deepEqual(errors,[]);
  console.log('PASS: domain save/failure/reset/persistence, admin login/logout, cloud backup restrictions.');
  console.log('PASS: cloud CRUD, empty synchronization, isolated local data, and save failure handling.');
} finally { await browser?.close(); server.kill(); }
