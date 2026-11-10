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
  await page.locator('#btnSkipToContent').focus();await page.keyboard.press('Enter');assert.equal(await page.evaluate(()=>document.activeElement.id),'viewShortener');
  assert.equal(await page.locator('#btnSaveSettingsDomain').isDisabled(),true);
  await page.evaluate(()=>document.fonts.ready);
  assert.equal(await page.evaluate(()=>document.fonts.check('900 16px "Font Awesome 6 Free"')),true);
  await page.click('#btnOpenCreateModal');await page.fill('#modalDestUrl','example.com/path');await page.fill('#modalSlug','Promo-TEST');
  assert.equal(await page.locator('#waPreviewTextLink').getAttribute('href'),base+'/Promo-TEST');
  await page.click('#btnSaveModalLink');
  await page.locator('#linkDetailsModal').waitFor({state:'visible'});
  assert.match(await page.locator('.link-summary-card').textContent(),/Promo-TEST/);
  assert.equal(await page.locator('#detailShortUrl').getAttribute('href'),base+'/Promo-TEST');
  await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>document.activeElement.classList.contains('link-summary-card')),true);
  assert.equal(await page.locator('.link-card button').count(),0);
  await page.click('#btnOpenCreateModal');await page.fill('#modalDestUrl','example.com/other');await page.fill('#modalSlug','Promo-TEST');await page.click('#btnSaveModalLink');
  await page.locator('.toast').filter({hasText:'sudah digunakan'}).waitFor();assert.equal(await page.locator('.link-card').count(),1);await page.keyboard.press('Escape');
  await page.locator('.link-card').focus();await page.keyboard.press('Enter');await page.click('.btn-edit-action');
  await page.fill('#modalOgTitle', 'Promo mobile & desktop');
  await page.click('.advanced-options summary');
  await page.fill('#modalPassword', ' 1234 '); await page.fill('#modalTags', 'bisnis, promo'); await page.fill('#utmSource','instagram');
  await page.setInputFiles('#modalFileInput', { name:'preview.png', mimeType:'image/png', buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5FoAAAAASUVORK5CYII=','base64') });
  await page.waitForFunction(() => document.getElementById('modalOgImage').value.startsWith('data:image/png'));
  await page.click('#btnSaveModalLink'); await page.locator('#modalLink').waitFor({state:'hidden'});
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('autoshort_links'))[0]);
  assert.equal(new URL(saved.destination_url).searchParams.get('utm_source'),'instagram'); assert.equal(saved.tags.length,2);
  await page.click('#btnCloseLinkDetails');
  await page.fill('#searchInput','nonesuch'); assert.equal(await page.locator('.link-card').count(),0);
  await page.fill('#searchInput','bisnis'); assert.equal(await page.locator('.link-card').count(),1);
  for(const width of [320,390,768,1440]) {
    await page.setViewportSize({width,height:900});await page.locator('.link-card').click();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
    assert.match(await page.locator('#linkDetailsContent').textContent(),/Kedaluwarsa/);
    await page.screenshot({path:`test-results/link-details-${width}.png`,fullPage:true});
    await page.click('#btnCloseLinkDetails');
  }
  // Password gate and tracking only after successful unlock.
  const visitor = await context.newPage(); visitor.on('pageerror', e => errors.push(e.message));
  await visitor.goto(base + '/Promo-TEST?src=qr'); await visitor.locator('#stateProtected').waitFor({state:'visible'});
  await visitor.fill('#passwordInput','wrong'); await visitor.click('#btnSubmitPassword'); await visitor.locator('#passwordError').waitFor({state:'visible'});
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('autoshort_clicks') || '[]').length),0);
  await visitor.fill('#passwordInput',' 1234 '); await visitor.click('#btnSubmitPassword'); await visitor.waitForURL('https://example.com/**');
  assert.equal((await page.evaluate(() => JSON.parse(localStorage.getItem('autoshort_clicks'))))[0].is_qr,true);
  await visitor.close();
  await page.locator('.link-card').click();
  await page.click('.btn-pause-action'); await page.locator('.status-paused').waitFor();
  const paused = await context.newPage(); await paused.goto(base + '/Promo-TEST'); await paused.locator('#statePaused').waitFor({state:'visible'}); await paused.close();
  await page.click('.btn-pause-action'); await page.locator('.status-protected').waitFor();
  // QR output has the selected pixel dimensions and no CDN dependency.
  await page.click('.btn-qr-action'); await page.locator('#qrStudioBox canvas').waitFor();
  await page.selectOption('#qrResolution','2048');
  const downloadPromise = page.waitForEvent('download'); await page.click('#btnDownloadStudioQr'); const download=await downloadPromise;
  const png=await readFile(await download.path()); assert.equal(png.readUInt32BE(16),2048); assert.equal(png.readUInt32BE(20),2048);
  const decoded = PNG.sync.read(png);
  assert.equal(jsQR(new Uint8ClampedArray(decoded.data), decoded.width, decoded.height).data, base + '/Promo-TEST?src=qr');
  await page.selectOption('#qrResolution','512');
  await page.evaluate(() => document.getElementById('toastContainer').replaceChildren());
  // Every view must fit both desktop and phone widths, including a 320 px screen.
  for (const width of [1440,768,390,320]) {
    await page.setViewportSize({width,height:900});
    for (const view of ['home','analytics','shortener','qr-studio','activity','domains','settings']) {
      await page.goto(base + '/#' + view);
      await page.waitForTimeout(80);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
      assert.equal(overflow,false,`Horizontal overflow: ${view} at ${width}`);
      await page.screenshot({path:`test-results/${view}-${width}.png`,fullPage:true});
    }
  }
  await page.setViewportSize({width:390,height:844}); await page.goto(base + '/#shortener');
  for (const view of ['analytics','qr-studio','domains','shortener']) {
    await page.locator(`.mobile-nav-link[data-view="${view}"]`).click();
    await page.waitForFunction(view=>document.querySelector(`.mobile-nav-link[data-view="${view}"]`)?.getAttribute('aria-current')==='page',view);
    assert.equal(await page.locator(`.mobile-nav-link[data-view="${view}"]`).getAttribute('aria-current'),'page');
    assert.equal(await page.locator(view === 'domains' ? '#viewDomains' : view === 'shortener' ? '#viewShortener' : view === 'analytics' ? '#viewAnalytics' : '#viewQrStudio').isVisible(),true);
  }
  assert.equal(await page.locator('#viewSettings').isVisible(),false);
  await page.click('#btnMobileMenuToggle'); await page.locator('#menuBackdrop').waitFor({state:'visible'});
  assert.equal(await page.evaluate(()=>document.querySelector('.sid-main-wrapper').inert),true);
  assert.equal(await page.evaluate(()=>document.activeElement.id),'btnCloseSidebar');
  await page.locator('#btnThemeToggle').focus();await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(()=>document.activeElement.classList.contains('sid-brand-logo')),true);
  await page.keyboard.press('Shift+Tab');assert.equal(await page.evaluate(()=>document.activeElement.id),'btnThemeToggle');
  await page.click('#btnCloseSidebar');assert.equal(await page.evaluate(()=>document.activeElement.id),'btnMobileMenuToggle');
  assert.equal(await page.evaluate(()=>document.querySelector('#sidSidebar').inert),true);
  await page.click('#btnMobileMenuToggle'); await page.locator('#menuBackdrop').waitFor({state:'visible'});
  await page.click('#sidebarNavAnalytics .nav-link'); assert.equal(await page.locator('#menuBackdrop').isVisible(),false);
  async function chooseRange(target,start,end) {
    await target.click('#btnDateRangeDropdown');
    const [sy,sm]=start.split('-');await target.selectOption('#calYearSelect',sy);await target.selectOption('#calMonthSelect',String(Number(sm)-1));await target.click(`[data-date="${start}"]`);
    const [ey,em]=end.split('-');await target.selectOption('#calYearSelect',ey);await target.selectOption('#calMonthSelect',String(Number(em)-1));await target.click(`[data-date="${end}"]`);
  }
  assert.equal(await page.locator('#viewAnalytics .sid-metrics-row').count(),0);
  assert.equal(await page.locator('.cal-preset-btn, #calendarRangeHint').count(),0);
  for(let days=1;days<=7;days++){await chooseRange(page,'2026-01-10',`2026-01-${9+days}`);assert.equal(await page.locator('.chart-bar-column').count(),days<=2?days*24:days);}
  await chooseRange(page,'2026-01-10','2026-01-10');
  await page.selectOption('#chartDetailSelect',{index:14});assert.match(await page.locator('#chartSelectedDetail').textContent(),/14.00/);
  await page.locator('.chart-bar-column').nth(9).click();assert.match(await page.locator('#chartSelectedDetail').textContent(),/09.00/);
  await chooseRange(page,'2026-01-10','2026-01-11');assert.equal(await page.locator('.chart-bar-column').count(),48);
  for(const width of [320,390,768,1440]){
    await page.setViewportSize({width,height:900});
    assert.equal(await page.locator('.performance-table-card .table-responsive').evaluate(e=>e.scrollWidth>e.clientWidth+1),false);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
    await page.screenshot({path:`test-results/analytics-hourly-${width}.png`,fullPage:true});
  }
  await page.setViewportSize({width:390,height:844});
  assert.ok(!(await page.locator('#dateRangeDisplayText').textContent()).includes('hari'));
  await page.click('#btnDateRangeDropdown');await page.selectOption('#calYearSelect','2026');await page.selectOption('#calMonthSelect','0');await page.click('[data-date="2026-01-10"]');
  assert.equal(await page.locator('[data-date="2026-01-17"]').isDisabled(),true);
  const picker=await page.locator('#calendarPopup').boundingBox();assert.ok(picker.width<=300 && picker.height<=350);
  await page.screenshot({path:'test-results/analytics-calendar-390.png',fullPage:true});
  await page.click('[data-date="2026-01-16"]');assert.equal(await page.locator('.chart-bar-column').count(),7);
  await chooseRange(page,'2026-02-02','2026-01-27');assert.equal(await page.locator('.chart-bar-column').count(),7);
  const dates=await page.evaluate(()=>{const end=new Date(),start=new Date();start.setDate(end.getDate()-6);const format=d=>[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');return [format(start),format(end)];});
  await chooseRange(page,...dates);

  await page.goto(base + '/#shortener'); await page.click('#btnOpenCreateModal'); await page.fill('#modalDestUrl','example.com'); await page.fill('#modalSlug','new-mobile');
  await page.screenshot({path:'test-results/modal-mobile.png'}); await page.keyboard.press('Escape'); assert.equal(await page.locator('#modalLink').isVisible(),false);
  await page.goto(base+'/#home');await page.waitForFunction(()=>document.body.dataset.view==='home');
  assert.equal(await page.locator('#homeTotalClicks').textContent(),'1');assert.equal(await page.locator('#homeQrClicks').textContent(),'1');assert.equal(await page.locator('.home-activity-item').count(),1);
  await page.goto(base+'/#analytics');
  const today=await page.evaluate(()=>{const d=new Date();return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');});
  await chooseRange(page,today,today);
  const hour=await page.evaluate(()=>new Date(JSON.parse(localStorage.getItem('autoshort_clicks'))[0].clicked_at).getHours());
  await page.locator('.chart-bar-column').nth(hour).click();assert.match(await page.locator('#chartSelectedDetail').textContent(),/1 klik/);
  const perf=page.locator('.perf-link');await perf.click();await page.locator('#linkDetailsModal').waitFor({state:'visible'});await page.click('#btnCloseLinkDetails');
  assert.equal(await page.evaluate(()=>document.activeElement.classList.contains('perf-link')),true);
  await chooseRange(page,...dates);

  await page.goto(base + '/#analytics');
  await page.waitForFunction(()=>document.body.dataset.view==='analytics');
  assert.equal(await page.locator('#yAxisTop').textContent(),'2');
  await page.click('#btnDownloadCsv').catch(()=>{});
  // Backup and restore preserve data, and expiry blocks a visit without logging it.
  await page.goto(base + '/#settings');
  const backupPromise = page.waitForEvent('download'); await page.click('#btnExportJsonBackup'); const backupDownload = await backupPromise;
  const backup = await readFile(await backupDownload.path());
  page.on('dialog', dialog => dialog.accept());
  await page.click('#btnResetAllData');
  await page.setInputFiles('#inputImportBackup', { name:'backup.json',mimeType:'application/json',buffer:backup });
  await page.locator('.toast').filter({hasText:'Cadangan berhasil dipulihkan'}).waitFor();
  await page.goto(base + '/#shortener'); await page.locator('.link-card').click(); await page.click('.btn-edit-action');
  await page.fill('#modalExpires','2000-01-01T00:00'); await page.click('#btnSaveModalLink');
  await page.locator('.status-expired').waitFor();
  await page.click('#btnCloseLinkDetails');
  const expired = await context.newPage(); await expired.goto(base + '/Promo-TEST'); await expired.locator('#stateExpired').waitFor({state:'visible'}); await expired.close();
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('autoshort_clicks')).length),1);
  // Theme persists across reload.
  await page.click('#btnMobileMenuToggle'); await page.click('#btnThemeToggle'); await page.reload(); assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
  assert.deepEqual(errors,[]);
  console.log('PASS: user flows, mobile navigation, separate domain/settings views and 28 responsive views.');
  await page.screenshot({path:'test-results/analytics-dark-390.png',fullPage:true});
  await page.goto(base+'/#domains'); await page.screenshot({path:'test-results/domains-dark-390.png',fullPage:true});
  await page.setViewportSize({width:1440,height:1000}); await page.screenshot({path:'test-results/domains-dark-1440.png',fullPage:true});
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
  await cloudPage.click('#btnOpenCreateModal');await cloudPage.fill('#modalDestUrl','example.com');await cloudPage.fill('#modalSlug','Cloud-PROMO');await cloudPage.click('#btnSaveModalLink');
  await cloudPage.locator('#linkDetailsModal').waitFor({state:'visible'});assert.equal(await cloudPage.locator('#detailShortUrl').getAttribute('href'),'https://short.example/Cloud-PROMO');
  assert.equal(await cloudPage.evaluate(()=>localStorage.getItem('autoshort_links')),null);
  failSave=true; await cloudPage.click('.btn-edit-action'); await cloudPage.fill('#modalOgTitle','Will fail'); await cloudPage.click('#btnSaveModalLink');
  await cloudPage.locator('.toast').filter({hasText:'Database tidak tersedia'}).waitFor(); assert.equal(await cloudPage.locator('#modalLink').isVisible(),true);
  await cloudPage.keyboard.press('Escape'); failSave=false;
  await cloudPage.locator('.link-card').click();
  cloudPage.on('dialog', d=>d.accept()); await cloudPage.click('.btn-delete-action'); await cloudPage.locator('.link-card').waitFor({state:'hidden'});
  await cloudPage.goto(base+'/#analytics'); await cloudPage.click('#btnRefreshAnalytics'); assert.equal(await cloudPage.locator('#tableLinksAnalyticsBody tr').count(),1);assert.match(await cloudPage.locator('#tableLinksAnalyticsBody').textContent(),/Belum ada/);
  await cloudPage.goto(base+'/#settings');
  assert.equal(await cloudPage.locator('#btnImportBackup').isDisabled(),true);
  assert.equal(await cloudPage.locator('#btnResetAllData').isDisabled(),true);
  await cloudPage.goto(base+'/#domains');
  assert.equal(await cloudPage.locator('#viewSettings').isVisible(),false);
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
  await cloudPage.goto(base+'/#settings');
  assert.equal(await cloudPage.locator('#viewDomains').isVisible(),false);
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
  const signedOut=await browser.newContext({viewport:{width:390,height:844}});
  await signedOut.route('**/api/**',route=>new URL(route.request().url()).pathname==='/api/config'?route.fulfill({json:{configured:true,customDomain:''}}):route.fulfill({status:401,json:{error:'Token admin diperlukan'}}));
  const signedOutPage=await signedOut.newPage();await signedOutPage.goto(base);
  await signedOutPage.waitForFunction(()=>document.body.dataset.view==='home');
  await signedOutPage.locator('#storageNotice a').waitFor();
  assert.equal(await signedOutPage.locator('#btnOpenCreateModal').isDisabled(),true);
  assert.equal(await signedOutPage.locator('#homeTotalLinks').textContent(),'—');
  assert.equal(await signedOutPage.locator('#btnHomeCreate').isDisabled(),true);
  assert.match(await signedOutPage.locator('#homeRecentLinks').textContent(),/Masuk admin/);
  await signedOutPage.screenshot({path:'test-results/home-signed-out-390.png',fullPage:true});
  await signedOutPage.locator('#storageNotice a').click();await signedOutPage.locator('#viewSettings').waitFor({state:'visible'});
  await signedOut.close();
  console.log('PASS: keyboard menu/focus handling, local icons, signed-out cloud state and default home page.');
  const listContext=await browser.newContext({viewport:{width:390,height:900},permissions:['clipboard-read','clipboard-write']});
  await listContext.addInitScript(()=>localStorage.getItem('autoshort_links') || localStorage.setItem('autoshort_links',JSON.stringify([1,2,3].map(n=>({id:'list-'+n,slug:'list-'+n,title:'Link '+n,destination_url:'https://example.com/private-target-'+n,tags:['detail-only-tag'],is_active:true,clicks:n,created_at:new Date().toISOString()})))));
  const listPage=await listContext.newPage();await listPage.goto(base+'/#shortener');await listPage.locator('.link-summary-card').nth(2).waitFor();
  for(const width of [320,390,768,1440]){
    await listPage.setViewportSize({width,height:900});
    const boxes=await listPage.locator('.link-summary-card').evaluateAll(cards=>cards.map(c=>{const r=c.getBoundingClientRect();return {x:r.x,y:r.y,bottom:r.bottom,width:r.width};}));
    assert.equal(boxes.length,3);assert.ok(boxes[1].y>=boxes[0].bottom&&boxes[2].y>=boxes[1].bottom);assert.equal(boxes[0].width,boxes[1].width);
    assert.ok(!(await listPage.locator('.link-summary-card').nth(1).textContent()).includes('private-target-2'));
    await listPage.locator('.link-summary-card').nth(1).click();assert.equal(await listPage.locator('#linkDetailsTitle').textContent(),'Link 2');assert.match(await listPage.locator('#linkDetailsContent').textContent(),/private-target-2/);
    await listPage.click('[data-action="copy"]');assert.equal(await listPage.evaluate(()=>navigator.clipboard.readText()),base+'/list-2');
    await listPage.locator('#linkDetailsModal').click({position:{x:5,y:5}});assert.equal(await listPage.locator('#linkDetailsModal').isVisible(),false);
  }
  await listPage.goto(base);await listPage.waitForFunction(()=>document.body.dataset.view==='home');
  assert.equal(await listPage.locator('#homeTotalLinks').textContent(),'3');assert.equal(await listPage.locator('#homeTotalClicks').textContent(),'6');assert.equal(await listPage.locator('#homeActiveLinks').textContent(),'3');assert.equal(await listPage.locator('#homeQrClicks').textContent(),'0');
  assert.equal(await listPage.locator('.home-recent-link').count(),3);assert.match(await listPage.locator('#homeRecentActivity').textContent(),/Belum ada kunjungan/);
  await listPage.locator('.home-recent-link').nth(1).click();await listPage.click('#btnCloseLinkDetails');assert.equal(await listPage.evaluate(()=>document.activeElement.classList.contains('home-recent-link')),true);
  await listPage.click('#btnHomeCreate');await listPage.locator('#modalLink').waitFor({state:'visible'});await listPage.keyboard.press('Escape');
  assert.equal(await listPage.evaluate(()=>document.activeElement.id),'btnHomeCreate');
  for(const width of [320,390,768,1440]){await listPage.setViewportSize({width,height:900});assert.equal(await listPage.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);await listPage.screenshot({path:`test-results/home-summary-${width}.png`,fullPage:true});}
  await listPage.evaluate(()=>{
    localStorage.setItem('autoshort_links',JSON.stringify(Array.from({length:7},(_,n)=>({id:'home-'+n,slug:'home-'+n,title:'Link '+n,destination_url:'https://example.com/'+n,clicks:n,created_at:new Date(Date.UTC(2026,0,n+1)).toISOString(),is_active:n!==2,password:n===1?'private':null,expires_at:n===3?'2000-01-01':null}))));
    localStorage.setItem('autoshort_clicks',JSON.stringify([{link_id:'home-0',slug:'old-visit',clicked_at:'2000-01-01T00:00:00Z',is_qr:true},{link_id:'home-6',slug:'recent-visit',clicked_at:new Date().toISOString(),is_qr:false}]));
  });
  await listPage.reload();await listPage.locator('.home-recent-link').nth(4).waitFor();
  assert.equal(await listPage.locator('#homeTotalClicks').textContent(),'21');assert.equal(await listPage.locator('#homeActiveLinks').textContent(),'5');assert.equal(await listPage.locator('#homeQrClicks').textContent(),'1');
  assert.deepEqual(await listPage.locator('.home-recent-link').evaluateAll(rows=>rows.map(row=>row.dataset.id)),['home-6','home-5','home-4','home-3','home-2']);
  assert.match(await listPage.locator('.home-activity-item').first().textContent(),/recent-visit/);
  await listPage.evaluate(()=>{localStorage.setItem('autoshort_theme','dark');});await listPage.reload();await listPage.screenshot({path:'test-results/home-dark-1440.png',fullPage:true});
  await listPage.setViewportSize({width:390,height:900});await listPage.screenshot({path:'test-results/home-dark-390.png',fullPage:true});
  await listContext.close();console.log('PASS: stacked cards, detail isolation, copy URL, home totals, empty activity, home create action and focus restoration.');

} finally { await browser?.close(); server.kill(); }
