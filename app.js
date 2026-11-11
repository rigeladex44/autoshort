import { buildAnalyticsBuckets } from './lib/analytics.js';
import { normalizeLink, normalizeUrl, normalizeSlug, linkState, csvCell } from './lib/validation.js';
/**
 * AutoShort — Real-Time Analytics Engine & Shortlink Suite
 * Provides visitor analytics, an interactive calendar,
 * stacked visitor tracking, QR Studio, live activity monitoring,
 * and cloud database synchronization.
 */

(function () {
  'use strict';

  // --- CONFIGURATION & STATE ---
  let cloudMode = false;
  let adminConnected = false;
  let currentUser = null;
  let authMode = 'login';
  let googleEnabled = false;
  let platformDomain = location.host;
  let pollTimer = null;
  let domainsLoadedFor = null;
  let vercelConnected = false;
  let vercelManagedByServer = false;
  let backendReady = Promise.resolve();
  let syncPromise = null;
  let saving = false;
  let searchTerm = '';
  let selectedLinkId = null;
  let returnFocus = null;
  function shortUrl(slug, qr = false) {
    const base = cloudMode ? (customDomain === location.host ? location.origin : `https://${customDomain}`) : location.origin;
    return `${base}/${encodeURIComponent(slug)}${qr ? '?src=qr' : ''}`;
  }
  async function api(path, options = {}) {
    const response = await fetch(path, { ...options, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', ...options.headers } });
    const data = await response.json();
    if (!response.ok) throw Object.assign(new Error(data.error || 'Permintaan server gagal.'), {status:response.status});
    return data;
  }
  function status(text, ok = false) {
    document.getElementById('cloudStatusText').textContent = text;
    document.getElementById('cloudStatusDot').style.background = ok ? '#10b981' : '#f59e0b';
  }
  async function persistLink(record, id = null) {
    const normalized = normalizeLink(record);
    if (cloudMode && !Object.hasOwn(record, 'password')) delete normalized.password;
    if (links.some(l => l.slug === normalized.slug && l.id !== id)) throw new Error('Slug sudah digunakan.');
    let saved = { ...normalized, id: id || crypto.randomUUID(), clicks: 0, created_at: new Date().toISOString() };
    if (cloudMode) saved = (await api('/api/links', { method: id ? 'PATCH' : 'POST', body: JSON.stringify({ ...normalized, ...(id ? { id } : {}) }) })).link;
    const index = links.findIndex(l => l.id === id);
    const previous = index >= 0 ? links[index] : null;
    if (index >= 0) links[index] = { ...previous, ...saved, ...(!cloudMode ? { clicks: previous.clicks, created_at: previous.created_at } : {}) };
    else links.unshift(saved);
    if (previous && previous.slug !== saved.slug) {
      if (activeLinkFilter === previous.slug) activeLinkFilter = saved.slug;
      clicksHistory.forEach(c => { if (c.link_id === id) c.slug = saved.slug; });
    }
    saveLocalLinks(); saveLocalClicks(); renderAll();
    return saved;
  }
  function renderAll() {
    renderHome(); renderAnalytics(); renderShortenerLinks(); renderLinkDetails();
    if (currentView === 'qr-studio') updateQrStudio();
    if (currentView === 'activity') renderActivityTable();
  }
  async function saveAction(button, work) {
    if (saving) return;
    saving = true; button.disabled = true;
    try { await backendReady; if (syncPromise) await syncPromise; await work(); } catch (error) { showToast(error.message, 'warning'); }
    finally { saving = false; button.disabled = false; updateDomainControls(); }
  }
  function closeModal() {
    document.getElementById('modalLink').style.display = 'none';
    document.body.classList.remove('modal-open');
    returnFocus?.focus();
  }
  function closeMenu(restoreFocus = false) {
    const wasOpen = document.getElementById('sidSidebar').classList.contains('open');
    document.getElementById('sidSidebar').classList.remove('open');
    document.getElementById('menuBackdrop').hidden = true;
    document.getElementById('btnMobileMenuToggle').setAttribute('aria-expanded', 'false');
    syncMenuAccessibility();
    if (wasOpen && restoreFocus === true) document.getElementById('btnMobileMenuToggle').focus();
  }
  function syncMenuAccessibility() {
    const mobile = matchMedia('(max-width: 768px)').matches;
    const sidebar = document.getElementById('sidSidebar');
    const open = mobile && sidebar.classList.contains('open');
    sidebar.inert = mobile && !open;
    document.querySelector('.sid-main-wrapper').inert = open;
    document.querySelector('.mobile-bottom-nav').inert = open;
    document.body.classList.toggle('menu-open', open);
    if (!mobile) { sidebar.classList.remove('open'); document.getElementById('menuBackdrop').hidden = true; document.getElementById('btnMobileMenuToggle').setAttribute('aria-expanded', 'false'); }
  }
  let customDomain = location.host;
  let currentView = 'home';

  // Dynamic Date Range (Defaults to last 7 days up to today)
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
  const sixDaysAgo = new Date(todayStart);
  sixDaysAgo.setDate(todayStart.getDate() - 6);

  let selectedStartDate = sixDaysAgo;
  let selectedEndDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  let calViewMonth = now.getMonth();
  let calViewYear = now.getFullYear();
  let tempRangeStart = null;

  // Filter
  let activeLinkFilter = 'all';

  // QR Studio State
  let qrSelectedSlug = '';
  let qrSelectedColor = '#000000';

  // Links and click history
  let links = [];
  let clicksHistory = [];

  // --- INITIALIZATION ---
  document.addEventListener('DOMContentLoaded', async () => {
    document.getElementById('btnSkipToContent').onclick = () => [...document.querySelectorAll('main')].find(main => main.style.display !== 'none')?.focus();
    sessionStorage.removeItem('autoshort_admin_token');
    localStorage.removeItem('autoshort_cloud_links');localStorage.removeItem('autoshort_cloud_clicks');
    await consumeAuthCallback();
    initTheme();
    initCalendar();
    initEventListeners();
    initExtraControls();
    setupRouting();
    renderAnalytics();
    renderShortenerLinks();
    renderHome();
    initQrStudio();
    backendReady = fetchBackendConfig();
    backendReady.catch(error => showToast(error.message, 'warning'));
  });

  // --- THEME ---
  function initTheme() {
    const saved = localStorage.getItem('autoshort_theme') || 'light';
    setTheme(saved);

    const btn = document.getElementById('btnThemeToggle');
    if (btn) {
      btn.onclick = () => {
        const cur = document.documentElement.getAttribute('data-theme') || 'light';
        setTheme(cur === 'light' ? 'dark' : 'light');
      };
    }
  }

  function setTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    localStorage.setItem('autoshort_theme', t);
    const icon = document.getElementById('themeIcon');
    if (icon) {
      icon.className = t === 'dark' ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
      icon.style.color = t === 'dark' ? '#f59e0b' : '';
    }
  }

  // --- DATA STORAGE & SYNC (REAL DATA ONLY) ---
  function loadStoredData() {
    try {
      const storedLinks = localStorage.getItem('autoshort_links');
      if (storedLinks) {
        try {
          const parsed = JSON.parse(storedLinks);
          links = Array.isArray(parsed) ? parsed.filter(l => l && l.slug && l.id) : [];
        } catch {
          links = [];
        }
      } else {
        links = [];
      }
      const storedClicks = localStorage.getItem('autoshort_clicks');
      if (storedClicks) {
        try {
          const parsedClicks = JSON.parse(storedClicks);
          clicksHistory = Array.isArray(parsedClicks) ? parsedClicks.filter(c => c && c.clicked_at) : [];
        } catch {
          clicksHistory = [];
        }
      } else {
        clicksHistory = [];
      }
      // Clear legacy dummy toggle flag
      localStorage.removeItem('autoshort_pure_real_mode');

      // Legacy browser-only domain values were never verified.
      localStorage.removeItem('autoshort_custom_domain');
      updateDomainDisplays();
    } catch (e) {
      console.error('Error loading stored data:', e);
      links = [];
      clicksHistory = [];
    }
  }

  function saveLocalLinks() {
    if (cloudMode) return;
    try { localStorage.setItem(cloudMode ? 'autoshort_cloud_links' : 'autoshort_links', JSON.stringify(links)); } catch { showToast('Opslag browser penuh atau tidak tersedia. Unduh cadangan data.', 'warning'); }
  }

  function saveLocalClicks() {
    if (cloudMode) return;
    try { localStorage.setItem(cloudMode ? 'autoshort_cloud_clicks' : 'autoshort_clicks', JSON.stringify(clicksHistory)); } catch { showToast('Riwayat tidak dapat disimpan di browser.', 'warning'); }
  }

  // --- REAL-TIME LISTENERS (CROSS-TAB & WEBSOCKET) ---
  // 1. Cross-tab real-time listener (fires instantly when someone visits link in another tab)
  window.addEventListener('storage', (e) => {
    if (cloudMode && e.key === 'autoshort_auth_event') { clearAccountData(); location.reload(); return; }
    if (cloudMode) return;
    if (e.key === 'autoshort_clicks' || e.key === 'autoshort_links') {
      const prevCount = clicksHistory.length;
      loadStoredData();
      renderHome();
      renderAnalytics();
      renderShortenerLinks();
      if (currentView === 'activity') renderActivityTable();
      if (clicksHistory.length > prevCount) {
        const latest = clicksHistory[clicksHistory.length - 1];
        showToast(`⚡ Kunjungan baru masuk: /${latest.slug} (${latest.is_qr ? 'Scan QR' : latest.referer || 'Direct'})!`, 'success');
      }
    }
  });

  async function fetchBackendConfig() {
    try {
      const config=await api('/api/config');cloudMode=config.configured;
      googleEnabled=config.googleEnabled===true;platformDomain=config.platformDomain||location.host;
      if(cloudMode){links=[];clicksHistory=[];currentUser=config.user||null;adminConnected=Boolean(currentUser);}
      else{currentUser=null;adminConnected=false;loadStoredData();}
      customDomain=config.customDomain||platformDomain;
      updateSettingsState();updateAdminUI();updateDomainDisplays();renderAll();renderAuthForm();
      if(cloudMode&&currentUser)await syncWithBackend().catch(error=>showToast(error.message,'warning'));
      else status(cloudMode?'Belum masuk':'Mode Lokal');
    }catch(error){status('Server tidak terhubung');const notice=document.getElementById('storageNotice');notice.hidden=false;notice.textContent='Server tidak dapat dimuat. Periksa koneksi dan muat ulang.';throw error;}
    if(!pollTimer)pollTimer=setInterval(()=>{if(cloudMode&&currentUser&&!document.hidden&&!saving)syncWithBackend().catch(()=>{});},15000);
  }
  async function syncWithBackend() {
    if (!cloudMode || !currentUser) return;
    if (syncPromise) return syncPromise;
    const pending = (async () => {
      const accountId=currentUser.id;
      try {
        const [linkData, clickData, domainData] = await Promise.all([api('/api/links'), api('/api/analytics'), api('/api/config')]);
        if(currentUser?.id!==accountId)return;
        if(domainData.user?.id!==accountId){clearAccountData();location.reload();return;}
        if (customDomain !== (domainData.customDomain || platformDomain)) {
          customDomain = domainData.customDomain || platformDomain;
          updateDomainDisplays();
        }
        links = linkData.links || [];
        clicksHistory = clickData.recentClicks || [];
        const firstAdminSync = domainsLoadedFor !== accountId;
        adminConnected = true;
        updateAdminUI();
        saveLocalLinks(); saveLocalClicks(); renderAll();
        updateDomainControls();
        if (firstAdminSync) await loadDomainManager().then(()=>{if(currentUser?.id===accountId)domainsLoadedFor=accountId;}).catch(error => { document.getElementById('vercelIntegrationStatus').textContent = error.message; });
        if(currentUser?.id!==accountId)return;
        document.getElementById('btnExportJsonBackup').disabled = false;
        document.getElementById('accountSessionStatus').textContent = 'Anda masuk. Tautan, statistik, dan pengaturan tersimpan di akun Anda.';
        status('Cloud Terhubung', true);
      } catch (error) { if(currentUser?.id!==accountId)return;if(error.status===401){clearAccountData();updateAdminUI();renderAll();}status('Cloud: perlu perhatian'); throw error; }
    })();
    syncPromise=pending;
    try { await pending; } finally { if(syncPromise===pending)syncPromise=null; }
  }
  async function refreshAnalyticsData() {
    try { await backendReady; await syncWithBackend(); renderAll(); showToast('Data berhasil disegarkan.', 'success'); }
    catch (error) { showToast(error.message, 'warning'); }
  }

  // --- ROUTING / VIEW SWITCHING ---
  function setupRouting() {
    const handleHash = () => {
      const hash = window.location.hash.replace('#', '') || 'home';
      switchView(hash);
    };

    window.addEventListener('hashchange', handleHash);
    handleHash();
  }

  function switchView(viewName) {
    if (['login','signup','recover','reset'].includes(viewName)){authMode=viewName;viewName='auth';}
    if (['beranda', 'dashboard'].includes(viewName)) viewName = 'home';
    if (!['auth','home', 'analytics', 'shortener', 'qr-studio', 'activity', 'domains', 'settings'].includes(viewName)) viewName = 'home';
    document.body.dataset.view = viewName;
    closeMenu();
    window.scrollTo(0, 0);
    currentView = viewName;
    const views = {
      auth:document.getElementById('viewAuth'),
      home: document.getElementById('viewHome'),
      analytics: document.getElementById('viewAnalytics'),
      shortener: document.getElementById('viewShortener'),
      'qr-studio': document.getElementById('viewQrStudio'),
      activity: document.getElementById('viewActivity'),
      domains: document.getElementById('viewDomains'),
      settings: document.getElementById('viewSettings')
    };

    const topTitle = document.getElementById('topbarTitle');
    const topIcon = document.getElementById('topbarIcon');

    // Hide all views
    Object.values(views).forEach(el => {
      if (el) el.style.display = 'none';
    });

    // Update nav active classes
    document.querySelectorAll('.nav-item, .mobile-nav-link').forEach(item => {
      const active = item.getAttribute('data-view') === viewName;
      item.classList.toggle('active', active);
      const link = item.matches('a') ? item : item.querySelector('a');
      if (active) link?.setAttribute('aria-current', 'page');
      else link?.removeAttribute('aria-current');
    });
    for (const [name, view] of Object.entries(views)) view?.setAttribute('aria-hidden', String(name !== viewName));

    if(viewName==='auth'){views.auth.style.display='block';topTitle.textContent='Akun';topIcon.className='fa-solid fa-user title-icon';renderAuthForm();}
    else if (viewName === 'home') {
      views.home.style.display = 'block';
      topTitle.textContent = 'Beranda';
      topIcon.className = 'fa-solid fa-house title-icon';
      renderHome();
    } else if (viewName === 'shortener') {
      if (views.shortener) views.shortener.style.display = 'block';
      if (topTitle) topTitle.textContent = 'Tautan';
      if (topIcon) topIcon.className = 'fa-solid fa-link title-icon';
      renderShortenerLinks();
    } else if (viewName === 'qr-studio') {
      if (views['qr-studio']) views['qr-studio'].style.display = 'block';
      if (topTitle) topTitle.textContent = 'QR Code Studio';
      if (topIcon) topIcon.className = 'fa-solid fa-qrcode title-icon';
      updateQrStudio();
    } else if (viewName === 'activity') {
      if (views.activity) views.activity.style.display = 'block';
      if (topTitle) topTitle.textContent = 'Aktivitas';
      if (topIcon) topIcon.className = 'fa-solid fa-wave-square title-icon';
      renderActivityTable();
    } else if (viewName === 'domains') {
      if (views.domains) views.domains.style.display = 'block';
      if (topTitle) topTitle.textContent = 'Domain';
      if (topIcon) topIcon.className = 'fa-solid fa-globe title-icon';
    } else if (viewName === 'settings') {
      if (views.settings) views.settings.style.display = 'block';
      if (topTitle) topTitle.textContent = 'Pengaturan';
      if (topIcon) topIcon.className = 'fa-solid fa-gear title-icon';
    } else {
      // Default: analytics
      if (views.analytics) views.analytics.style.display = 'block';
      if (topTitle) topTitle.textContent = 'Analitik';
      if (topIcon) topIcon.className = 'fa-solid fa-chart-column title-icon';
      renderAnalytics();
    }
  }

  // --- CALENDAR & DATE RANGE PICKER ---
  function initCalendar() {
    const btnDropdown = document.getElementById('btnDateRangeDropdown');
    const popup = document.getElementById('calendarPopup');
    const monthSelect = document.getElementById('calMonthSelect');
    const yearSelect = document.getElementById('calYearSelect');
    const btnPrev = document.getElementById('btnCalPrevMonth');
    const btnNext = document.getElementById('btnCalNextMonth');
    yearSelect.replaceChildren(...Array.from({ length: 31 }, (_, index) => { const option = document.createElement('option'); option.value = now.getFullYear() - 15 + index; option.textContent = option.value; return option; }));
    yearSelect.value = calViewYear; monthSelect.value = calViewMonth;

    if (btnDropdown && popup) {
      popup.addEventListener('click', event => event.stopPropagation());
      btnDropdown.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = popup.style.display === 'block';
        popup.style.display = isOpen ? 'none' : 'block';
        btnDropdown.classList.toggle('open', !isOpen);
        if (!isOpen) {
          tempRangeStart = null;
          calViewMonth = selectedEndDate.getMonth();
          calViewYear = selectedEndDate.getFullYear();
          if (monthSelect) monthSelect.value = calViewMonth;
          if (yearSelect) yearSelect.value = calViewYear;
          renderCalendarGrid();
        }
      });

      document.addEventListener('click', (e) => {
        if (!popup.contains(e.target) && !btnDropdown.contains(e.target)) {
          popup.style.display = 'none';
          btnDropdown.classList.remove('open');
        }
      });
    }

    if (monthSelect) {
      monthSelect.addEventListener('change', () => {
        calViewMonth = parseInt(monthSelect.value, 10);
        renderCalendarGrid();
      });
    }

    if (yearSelect) {
      yearSelect.addEventListener('change', () => {
        calViewYear = parseInt(yearSelect.value, 10);
        renderCalendarGrid();
      });
    }

    if (btnPrev) {
      btnPrev.addEventListener('click', () => {
        calViewMonth--;
        if (calViewMonth < 0) {
          calViewMonth = 11;
          calViewYear--;
        }
        if (monthSelect) monthSelect.value = calViewMonth;
        if (yearSelect) yearSelect.value = calViewYear;
        renderCalendarGrid();
      });
    }

    if (btnNext) {
      btnNext.addEventListener('click', () => {
        calViewMonth++;
        if (calViewMonth > 11) {
          calViewMonth = 0;
          calViewYear++;
        }
        if (monthSelect) monthSelect.value = calViewMonth;
        if (yearSelect) yearSelect.value = calViewYear;
        renderCalendarGrid();
      });
    }

    updateDateRangeButtonLabel();
  }

  function updateDateRangeButtonLabel() {
    const el = document.getElementById('dateRangeDisplayText');
    if (!el) return;
    const format = (d) => {
      const day = d.getDate();
      const month = d.toLocaleDateString('id-ID', { month: 'short' });
      const year = d.getFullYear();
      return `${day} ${month} ${year}`;
    };
    const days = calendarDayDistance(selectedStartDate, selectedEndDate) + 1;
    let range = format(selectedEndDate);
    if (days > 1) {
      const sameYear = selectedStartDate.getFullYear() === selectedEndDate.getFullYear();
      const startLabel = sameYear && selectedStartDate.getMonth() === selectedEndDate.getMonth() ? selectedStartDate.getDate() : sameYear ? `${selectedStartDate.getDate()} ${selectedStartDate.toLocaleDateString('id-ID', {month:'short'})}` : format(selectedStartDate);
      range = `${startLabel} — ${format(selectedEndDate)}`;
    }
    el.textContent = range;
  }

  function calendarDayDistance(a, b) {
    return Math.abs(Date.UTC(a.getFullYear(), a.getMonth(), a.getDate()) - Date.UTC(b.getFullYear(), b.getMonth(), b.getDate())) / 86400000;
  }
  function renderCalendarGrid() {
    const grid = document.getElementById('calDaysGrid');
    if (!grid) return;
    grid.innerHTML = '';

    const firstDay = new Date(calViewYear, calViewMonth, 1).getDay();
    const daysInMonth = new Date(calViewYear, calViewMonth + 1, 0).getDate();
    const daysInPrevMonth = new Date(calViewYear, calViewMonth, 0).getDate();

    for (let i = firstDay - 1; i >= 0; i--) {
      const cell = document.createElement('div');
      cell.className = 'cal-day-cell other-month';
      cell.textContent = daysInPrevMonth - i;
      grid.appendChild(cell);
    }

    const startISO = toISODate(tempRangeStart || selectedStartDate);
    const endISO = toISODate(tempRangeStart || selectedEndDate);

    for (let d = 1; d <= daysInMonth; d++) {
      const dateObj = new Date(calViewYear, calViewMonth, d);
      const iso = toISODate(dateObj);

      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'cal-day-cell';
      cell.textContent = d;
      cell.dataset.date = iso;
      cell.setAttribute('aria-label', dateObj.toLocaleDateString('id-ID', {dateStyle:'full'}));
      cell.disabled = Boolean(tempRangeStart && calendarDayDistance(tempRangeStart, dateObj) > 6);

      if (iso === startISO && iso === endISO) {
        cell.classList.add('single-selected');
      } else if (iso === startISO) {
        cell.classList.add('range-start');
      } else if (iso === endISO) {
        cell.classList.add('range-end');
      } else if (iso > startISO && iso < endISO) {
        cell.classList.add('in-range');
      }

      cell.addEventListener('click', () => {
        handleDateClick(dateObj);
      });

      grid.appendChild(cell);
    }

    const totalCells = firstDay + daysInMonth;
    const remaining = (7 - (totalCells % 7)) % 7;
    for (let i = 1; i <= remaining; i++) {
      const cell = document.createElement('div');
      cell.className = 'cal-day-cell other-month';
      cell.textContent = i;
      grid.appendChild(cell);
    }
  }

  function handleDateClick(dateObj) {
    if (tempRangeStart && calendarDayDistance(tempRangeStart, dateObj) > 6) { showToast('Rentang analisis maksimal 7 hari.', 'warning'); return; }
    if (!tempRangeStart) {
      tempRangeStart = new Date(dateObj);
      tempRangeStart.setHours(0, 0, 0, 0);
      renderCalendarGrid();
    } else {
      let start = tempRangeStart;
      let end = new Date(dateObj);
      if (end < start) {
        const tmp = start;
        start = end;
        end = tmp;
      }
      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);
      selectedStartDate = start;
      selectedEndDate = end;
      tempRangeStart = null;

      updateDateRangeButtonLabel();
      renderCalendarGrid();

      const popup = document.getElementById('calendarPopup');
      const btn = document.getElementById('btnDateRangeDropdown');
      if (popup) popup.style.display = 'none';
      if (btn) btn.classList.remove('open');

      renderAnalytics();
    }
  }

  function toISODate(d) {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  // --- REAL ANALYTICS ENGINE ---
  function renderAnalytics() {
    populateLinkFilterDropdown();

    const startISO = toISODate(selectedStartDate);
    const endISO = toISODate(selectedEndDate);

    const filteredClicks = clicksHistory.filter(c => {
      if (!c.clicked_at) return false;
      const cDate = toISODate(new Date(c.clicked_at));
      const inDateRange = cDate >= startISO && cDate <= endISO;
      if (!inDateRange) return false;

      if (activeLinkFilter !== 'all') {
        const match = c.link_id === links.find(l => l.slug === activeLinkFilter)?.id || c.slug === activeLinkFilter;
        if (!match) return false;
      }
      return true;
    });

    const summaryReady = !cloudMode || adminConnected;
    const summaryLinks = activeLinkFilter === 'all' ? links.length : links.filter(link=>link.slug===activeLinkFilter).length;
    const summaryUnique = new Set(filteredClicks.map(click=>click.visitor_id||click.id).filter(value=>value!==undefined&&value!==null)).size;
    for (const [id,value] of [['chartTotalLinks',summaryLinks],['chartVisitors',filteredClicks.length],['chartUniqueVisitors',summaryUnique]]) {
      document.getElementById(id).textContent=summaryReady?value.toLocaleString('id-ID'):'—';
    }
    const chartData=buildAnalyticsBuckets(selectedStartDate,selectedEndDate,filteredClicks);
    renderStackedBarChart(chartData);
    renderPerformanceTable(filteredClicks);
    renderDeepDiveBreakdowns(filteredClicks);
  }

  // --- STACKED BAR CHART RENDERING ---
  function renderStackedBarChart(chartData) {
    const track = document.getElementById('chartBarsTrack');
    const yAxisTop = document.getElementById('yAxisTop');
    const yAxisMid = document.getElementById('yAxisMid');
    if (!track) return;

    hideChartDetail();
    track.innerHTML = '';
    const hourly=Boolean(chartData[0]?.hourly);
    track.dataset.granularity=hourly?'hourly':'daily';
    const tooltip=document.getElementById('chartHoverDetail');
    const showDetail=(d,col)=>{
      tooltip.innerHTML=`<strong>${escapeHtml(d.label)}</strong><span>${d.visitors} klik · ${d.unique} unik · ${d.qr} QR</span>`;
      tooltip.hidden=false;
      for(const item of track.children){item.classList.toggle('is-selected',item===col);item.removeAttribute('aria-describedby');}
      col.setAttribute('aria-describedby','chartHoverDetail');
    };
    track.onpointerleave=event=>{if(event.pointerType==='mouse')hideChartDetail();};
    track.onfocusout=event=>{if(!track.contains(event.relatedTarget))hideChartDetail();};

    const maxDayTotal = Math.max(...chartData.map(d => d.visitors), 1);
    const magnitude = 10 ** Math.floor(Math.log10(maxDayTotal));
    const scaleMax = ([2, 4, 6, 8, 10].find(step => step * magnitude >= maxDayTotal) || 10) * magnitude;
    const scaleMid = Math.round(scaleMax / 2);

    if (yAxisTop) yAxisTop.textContent = scaleMax;
    if (yAxisMid) yAxisMid.textContent = scaleMid;

    const labelStep = hourly ? (chartData.length>26 && window.innerWidth<=768 ? 12 : 6) : Math.ceil(chartData.length/(window.innerWidth<=768?4:10));
    chartData.forEach((d, index) => {
      const col = document.createElement('div');
      col.className = 'chart-bar-column';
      col.tabIndex = 0;
      col.setAttribute('role','button');col.dataset.key=d.iso;
      if(index===0)col.classList.add('chart-first');if(index===chartData.length-1)col.classList.add('chart-last');
      col.setAttribute('aria-label', `${d.label}: ${d.visitors} kunjungan, ${d.unique} unik, ${d.qr} QR`);

      const totalVal = d.visitors;
      const heightPercent = totalVal > 0 ? Math.min(100, Math.round((totalVal / scaleMax) * 100)) : 0;
      const uniquePct = totalVal > 0 ? (Math.min(d.unique, d.visitors) / totalVal) * 100 : 0;
      const visitorsPct = 100;

      col.innerHTML = `
        <div class="stacked-bar-fill" style="height: ${heightPercent}%;">
          <div class="bar-segment-unique" style="height: ${uniquePct}%;"></div>
          <div class="bar-segment-visitors" style="height: ${visitorsPct}%;"></div>
        </div>
        <span class="bar-date-label" style="display:${(hourly ? (index+1)%labelStep===0 || index===chartData.length-1 : index%labelStep===0) ? 'block' : 'none'}">${d.shortLabel}</span>
        
      `;

      col.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); col.click(); } });
      col.addEventListener('click', () => {
        showDetail(d,col);
      });

      col.addEventListener('pointerenter',event=>{if(event.pointerType==='mouse')showDetail(d,col);});
      col.addEventListener('focus',()=>showDetail(d,col));
      track.appendChild(col);
    });
  }

  function hideChartDetail() {
    const tooltip=document.getElementById('chartHoverDetail');
    if(tooltip)tooltip.hidden=true;
    document.querySelectorAll('#chartBarsTrack .is-selected').forEach(col=>{col.classList.remove('is-selected');col.removeAttribute('aria-describedby');});
  }

  // --- PERFORMANCE PER SHORTLINK TABLE ---
  function renderPerformanceTable(filteredClicks) {
    const tbody = document.getElementById('tableLinksAnalyticsBody');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (links.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" class="text-center" style="padding:20px; color:#9ca3af;">Belum ada shortlink yang dibuat.</td></tr>';
      return;
    }

    links.filter(l => activeLinkFilter === 'all' || l.slug === activeLinkFilter).forEach(link => {
      const linkClicks = filteredClicks.filter(c => c.link_id === link.id || c.slug === link.slug);
      const totalVis = linkClicks.length;

      const uSet = new Set();
      let qrVis = 0;

      linkClicks.forEach(c => {
        uSet.add(c.visitor_id || c.id);
        if (c.is_qr || (c.referer && c.referer.toLowerCase().includes('qr'))) qrVis++;
      });

      const tr=document.createElement('tr');
      tr.innerHTML=`<td><button type="button" class="perf-link" data-id="${escapeHtml(link.id)}" aria-haspopup="dialog"><strong>${escapeHtml(link.title||link.slug)}</strong><span>/${escapeHtml(link.slug)}</span></button></td><td>${totalVis}</td><td>${uSet.size}</td><td>${qrVis}</td>`;
      tr.querySelector('button').onclick=()=>openLinkDetails(link.id);
      tbody.appendChild(tr);
    });
  }

  // --- DEEP-DIVE REFERRERS & DEVICES ---
  function renderDeepDiveBreakdowns(filteredClicks) {
    const elReferrers = document.getElementById('anaReferrersList');
    const elDevices = document.getElementById('anaDevicesList');

    const refCounts = {};
    const devCounts = { 'Smartphone (Mobile)': 0, 'PC / Laptop (Desktop)': 0, 'Tablet / iPad': 0, 'Tidak diketahui': 0 };

    filteredClicks.forEach(c => {
      const ref = c.referer || 'Direct';
      refCounts[ref] = (refCounts[ref] || 0) + 1;

      const ua = (c.user_agent || '').toLowerCase();
      if (ua.includes('tablet') || ua.includes('ipad')) devCounts['Tablet / iPad']++;
      else if (ua.includes('mobile') || ua.includes('android') || ua.includes('iphone')) devCounts['Smartphone (Mobile)']++;
      else if (/windows|macintosh|linux|cros/.test(ua)) devCounts['PC / Laptop (Desktop)']++;
      else devCounts['Tidak diketahui']++;
    });

    const total = filteredClicks.length || 1;

    if (elReferrers) {
      elReferrers.innerHTML = '';
      const sorted = Object.entries(refCounts).sort((a, b) => b[1] - a[1]);
      if (sorted.length === 0) {
        elReferrers.innerHTML = '<div style="font-size:0.8rem; color:#94a3b8;">Belum ada data referrers pada periode ini.</div>';
      } else {
        sorted.slice(0, 5).forEach(([name, count]) => {
          const pct = Math.round((count / total) * 100);
          const item = document.createElement('div');
          item.className = 'breakdown-item';
          item.innerHTML = `
            <div class="breakdown-item-header">
              <span><strong>${escapeHtml(name)}</strong></span>
              <span>${count} (${pct}%)</span>
            </div>
            <div class="breakdown-progress-track">
              <div class="breakdown-progress-fill" style="width: ${pct}%;"></div>
            </div>
          `;
          elReferrers.appendChild(item);
        });
      }
    }

    if (elDevices) {
      elDevices.innerHTML = '';
      if (filteredClicks.length === 0) {
        elDevices.innerHTML = '<div style="font-size:0.8rem; color:#94a3b8; padding:8px 0;">Belum ada data perangkat pada periode ini.</div>';
      } else {
        Object.entries(devCounts).forEach(([name, count]) => {
          const pct = Math.round((count / total) * 100);
          const item = document.createElement('div');
          item.className = 'breakdown-item';
          item.innerHTML = `
            <div class="breakdown-item-header">
              <span><strong>${escapeHtml(name)}</strong></span>
              <span>${count} (${pct}%)</span>
            </div>
            <div class="breakdown-progress-track">
              <div class="breakdown-progress-fill" style="width: ${pct}%; background:#06b6d4;"></div>
            </div>
          `;
          elDevices.appendChild(item);
        });
      }
    }
  }

  // --- QR STUDIO ---
  function initQrStudio() {
    const selectLink = document.getElementById('selectQrLink');
    const colorBtns = document.querySelectorAll('.color-btn');
    const btnDownload = document.getElementById('btnDownloadStudioQr');
    const btnTestScan = document.getElementById('btnTestStudioQrScan');

    if (colorBtns) {
      colorBtns.forEach(btn => {
        btn.addEventListener('click', () => {
          colorBtns.forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          qrSelectedColor = btn.getAttribute('data-color');
          updateQrStudio();
        });
      });
    }

    if (selectLink) {
      selectLink.addEventListener('change', () => {
        qrSelectedSlug = selectLink.value;
        updateQrStudio();
      });
    }

    if (btnDownload) {
      btnDownload.addEventListener('click', () => {
        try {
          const canvas = qrCanvas();
          const a = document.createElement('a'); a.download = `qr-${qrSelectedSlug}.png`; a.href = canvas.toDataURL('image/png'); a.click();
          showToast('QR Code berhasil diunduh.', 'success');
        } catch (error) { showToast(error.message, 'warning'); }
      });
    }

    if (btnTestScan) {
      btnTestScan.addEventListener('click', () => {
        simulateRealClick(qrSelectedSlug, null, true);
      });
    }
  }

  function updateQrStudio() {
    const selectLink = document.getElementById('selectQrLink');
    const urlText = document.getElementById('qrStudioUrlText');
    const box = document.getElementById('qrStudioBox');
    if (!selectLink || !box) return;

    // Populate dropdown
    selectLink.innerHTML = '';

    if (links.length === 0) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = '(Belum ada shortlink)';
      selectLink.appendChild(opt);
      if (urlText) urlText.textContent = `https://${customDomain}/...`;
      box.innerHTML = '<div style="color:#94a3b8; font-size:0.85rem; text-align:center; padding:30px 10px;"><i class="fa-solid fa-qrcode" style="font-size:2.5rem; margin-bottom:10px; display:block; opacity:0.3;"></i>Buat shortlink terlebih dahulu untuk menghasilkan QR Code.</div>';
      return;
    }

    links.forEach(l => {
      const opt = document.createElement('option');
      opt.value = l.slug;
      opt.textContent = `/${l.slug} — ${l.title || l.slug}`;
      selectLink.appendChild(opt);
    });

    if (!qrSelectedSlug || !links.some(l => l.slug === qrSelectedSlug)) {
      qrSelectedSlug = links[0].slug;
    }
    selectLink.value = qrSelectedSlug;

    const qrUrl = shortUrl(qrSelectedSlug, true);
    if (urlText) urlText.textContent = qrUrl;

    box.innerHTML = '';
    try { const canvas = qrCanvas(240); canvas.style.width = '240px'; canvas.style.height = '240px'; box.appendChild(canvas); }
    catch (error) { box.textContent = error.message; }
  }

  // --- ACTIVITY REAL-TIME TABLE ---
  function renderActivityTable() {
    const tbody = document.getElementById('activityTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';

    const recent = [...clicksHistory].sort((a, b) => new Date(b.clicked_at) - new Date(a.clicked_at)).slice(0, 25);
    if (recent.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-center" style="padding:20px; color:#9ca3af;">Belum ada riwayat aktivitas kunjungan.</td></tr>';
      return;
    }

    recent.forEach(c => {
      const time = c.clicked_at ? new Date(c.clicked_at).toLocaleString('id-ID') : 'Baru saja';
      const isQr = c.is_qr || (c.referer && c.referer.toLowerCase().includes('qr'));

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="font-family:'JetBrains Mono',monospace; font-size:0.76rem; color:var(--text-muted);">${time}</td>
        <td><strong style="color:var(--brand-primary);">/${escapeHtml(c.slug)}</strong></td>
        <td><span style="background:var(--bg-hover); padding:3px 8px; border-radius:4px;">${escapeHtml(c.referer || 'Direct')}</span></td>
        <td>
          <span style="color:${isQr ? '#0284c7' : '#15803d'}; font-weight:700;">
            ${isQr ? '<i class="fa-solid fa-qrcode"></i> Scan QR' : '<i class="fa-solid fa-arrow-pointer"></i> Klik Web'}
          </span>
        </td>
        <td style="font-size:0.78rem; color:var(--text-secondary);">${escapeHtml(c.user_agent || 'Unknown Device')}</td>
        <td style="font-family:'JetBrains Mono',monospace; font-size:0.75rem; color:var(--text-muted);">${escapeHtml(c.visitor_id ? c.visitor_id.substring(0, 14) + '...' : '-')}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  // --- LINK FILTER DROPDOWN ---
  function populateLinkFilterDropdown() {
    const select = document.getElementById('selectLinkFilter');
    if (!select) return;
    const currentVal = select.value;
    select.innerHTML = '<option value="all">Semua link</option>';

    links.forEach(l => {
      const opt = document.createElement('option');
      opt.value = l.slug;
      opt.textContent = `/${l.slug} (${l.title || l.slug})`;
      select.appendChild(opt);
    });

    if (!links.some(l => l.slug === activeLinkFilter)) activeLinkFilter = 'all';
    select.value = activeLinkFilter;
  }

  // --- REAL CLICK TRACKING & LIVE EVENT ---
  function simulateRealClick(targetSlug, targetId, isQr = false) {
    const link = targetSlug ? links.find(l => l.slug === targetSlug) : (targetId ? links.find(l => l.id === targetId) : links[0]);
    if (!link) return showToast('Buat tautan terlebih dahulu.', 'warning');
    window.open(shortUrl(link.slug, isQr), '_blank', 'noopener');
  }

  // Home always summarizes all loaded data, independently from analytics filters.
  function renderHome() {
    const ready = !cloudMode || adminConnected;
    const put = (id,value) => { document.getElementById(id).textContent = ready ? value.toLocaleString('id-ID') : '—'; };
    put('homeTotalLinks', links.length);
    put('homeTotalClicks', links.reduce((sum,link)=>sum+(Number(link.clicks)||0),0));
    put('homeActiveLinks', links.filter(link=>['active','protected'].includes(linkState(link))).length);
    put('homeQrClicks', clicksHistory.filter(click=>click.is_qr).length);
    const recentLinks=document.getElementById('homeRecentLinks');
    const activity=document.getElementById('homeRecentActivity');
    recentLinks.replaceChildren();activity.replaceChildren();
    if (!ready) {
      for(const container of [recentLinks,activity]) {
        const message=document.createElement(container===activity?'li':'p');message.className='home-empty';message.append('Masuk ke akun Anda untuk melihat data cloud. ');
        const login=document.createElement('a');login.href='#login';login.textContent='Masuk akun';message.append(login);container.append(message);
      }
      return;
    }
    const latest=[...links].sort((a,b)=>(Date.parse(b.created_at)||0)-(Date.parse(a.created_at)||0)).slice(0,5);
    for(const link of latest) {
      const button=document.createElement('button');button.type='button';button.className='home-recent-link';button.dataset.id=link.id;button.setAttribute('aria-haspopup','dialog');button.setAttribute('aria-controls','linkDetailsModal');
      button.innerHTML=`<span><strong>${escapeHtml(link.og_title||link.title||link.slug)}</strong><small>${escapeHtml(shortUrl(link.slug))}</small></span><span class="home-link-clicks">${(Number(link.clicks)||0).toLocaleString('id-ID')} klik <i class="fa-solid fa-chevron-right" aria-hidden="true"></i></span>`;
      button.onclick=()=>openLinkDetails(link.id);recentLinks.append(button);
    }
    if (!latest.length) recentLinks.innerHTML='<p class="home-empty">Belum ada link. Klik <strong>Buat link</strong> untuk mulai membagikan tautan Anda.</p>';
    for(const click of [...clicksHistory].sort((a,b)=>(Date.parse(b.clicked_at)||0)-(Date.parse(a.clicked_at)||0)).slice(0,5)) {
      const li=document.createElement('li');li.className='home-activity-item';
      const date=new Date(click.clicked_at);
      const label=Number.isNaN(date.getTime())?'Waktu tidak tersedia':date.toLocaleString('id-ID',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
      li.innerHTML=`<span class="home-activity-icon"><i class="fa-solid ${click.is_qr?'fa-qrcode':'fa-arrow-pointer'}" aria-hidden="true"></i></span><span class="home-activity-main"><strong>${escapeHtml(click.slug||'Link')}</strong><small>${click.is_qr?'Scan QR':'Klik web'}</small></span><time>${escapeHtml(label)}</time>`;
      activity.append(li);
    }
    if (!activity.children.length) activity.innerHTML='<li class="home-empty">Belum ada kunjungan tercatat. Aktivitas akan muncul setelah link Anda dikunjungi.</li>';
  }

  // --- LINK LIST & ON-DEMAND DETAILS ---
  function renderShortenerLinks() {
    const container = document.getElementById('linksCardsContainer');
    const badge = document.getElementById('linksCountBadge');
    const empty = document.getElementById('emptyState');
    container.replaceChildren();
    badge.textContent = `${links.length} link`;
    const needsAdmin = cloudMode && !adminConnected;
    empty.querySelector('h4').textContent = needsAdmin ? 'Tautan Anda tersimpan di cloud' : 'Belum ada link';
    empty.querySelector('p').textContent = needsAdmin ? 'Masuk ke akun Anda untuk melihat dan mengelola tautan. ' : 'Klik Buat link untuk membuat shortlink pertama Anda.';
    if (needsAdmin) { const a=document.createElement('a');a.href='#login';a.textContent='Masuk akun';empty.querySelector('p').append(a); }
    empty.style.display = links.length ? 'none' : 'block';
    const visible = links.filter(l => [l.title,l.og_title,l.slug,l.destination_url,...(l.tags || [])].join(' ').toLowerCase().includes(searchTerm));
    if (links.length && !visible.length) container.innerHTML = '<p class="search-empty">Tidak ada link yang cocok dengan pencarian.</p>';
    for (const link of visible) {
      const card = document.createElement('button');
      card.type='button';card.className='link-card link-summary-card';card.dataset.id=link.id;
      card.setAttribute('aria-haspopup','dialog');card.setAttribute('aria-controls','linkDetailsModal');
      const state=linkState(link);
      card.innerHTML = `
        <span class="link-summary-main"><span class="link-title">${escapeHtml(link.og_title || link.title || link.slug)}</span><span class="short-url-link">${escapeHtml((cloudMode ? customDomain : location.host)+'/'+link.slug)}</span></span>
        <span class="link-summary-meta"><span class="link-status status-${state}">${({active:'Aktif',paused:'Dijeda',expired:'Kedaluwarsa',protected:'Dilindungi'})[state]}</span><span class="link-summary-clicks">${(Number(link.clicks)||0).toLocaleString('id-ID')} klik</span></span>
        <i class="fa-solid fa-chevron-right link-summary-arrow" aria-hidden="true"></i>`;
      card.onclick=()=>openLinkDetails(link.id);
      container.append(card);
    }
  }
  function closeLinkDetails(restoreFocus = true) {
    const id=selectedLinkId;selectedLinkId=null;
    document.getElementById('linkDetailsModal').style.display='none';
    if (document.getElementById('modalLink').style.display==='none') document.body.classList.remove('modal-open');
    if (restoreFocus && id) {
      const card=[...document.querySelectorAll('.link-summary-card, .home-recent-link, .perf-link')].find(card=>card.dataset.id===id && card.offsetParent !== null);
      (card || document.getElementById(currentView==='home'?'btnHomeCreate':currentView==='analytics'?'selectLinkFilter':'btnOpenCreateModal')).focus();
    }
  }
  function openLinkDetails(id) {
    if (!links.some(link=>link.id===id)) return;
    document.getElementById('toastContainer').replaceChildren();
    selectedLinkId=id;renderLinkDetails();
    document.getElementById('linkDetailsModal').style.display='flex';document.body.classList.add('modal-open');
    document.getElementById('btnCloseLinkDetails').focus();
  }
  function renderLinkDetails() {
    if (!selectedLinkId) return;
    const link=links.find(link=>link.id===selectedLinkId);
    if (!link || (cloudMode && !adminConnected)) { closeLinkDetails();return; }
    const content=document.getElementById('linkDetailsContent');
    const focusedAction=content.contains(document.activeElement)?document.activeElement.dataset.action:null;
    const state=linkState(link);
    const formatDate=value=>{const date=new Date(value);return value && !Number.isNaN(date.getTime()) ? date.toLocaleString('id-ID',{dateStyle:'medium',timeStyle:'short'}) : '—';};
    document.getElementById('linkDetailsTitle').textContent=link.og_title || link.title || link.slug;
    content.innerHTML=`
      <div class="link-detail-url"><a id="detailShortUrl" href="${escapeHtml(shortUrl(link.slug))}" target="_blank" rel="noopener noreferrer">${escapeHtml(shortUrl(link.slug))}</a><button type="button" class="btn btn-primary btn-sm" data-action="copy"><i class="fa-regular fa-copy" aria-hidden="true"></i> Salin link</button></div>
      <dl class="link-detail-facts">
        <div><dt>URL tujuan</dt><dd>${escapeHtml(link.destination_url)}</dd></div>
        <div><dt>Status</dt><dd>${({active:'Aktif',paused:'Dijeda',expired:'Kedaluwarsa',protected:'Dilindungi'})[state]}</dd></div>
        <div><dt>Total klik</dt><dd>${(Number(link.clicks)||0).toLocaleString('id-ID')}</dd></div>
        <div><dt>Dibuat</dt><dd>${formatDate(link.created_at)}</dd></div>
        <div><dt>Kedaluwarsa</dt><dd>${link.expires_at?formatDate(link.expires_at):'Tidak diatur'}</dd></div>
        <div><dt>Password</dt><dd>${link.password || link.has_password?'Dilindungi':'Tidak diatur'}</dd></div>
        <div><dt>Tag</dt><dd>${(link.tags||[]).length?link.tags.map(escapeHtml).join(', '):'Tidak ada'}</dd></div>
        ${link.og_description?`<div><dt>Deskripsi</dt><dd>${escapeHtml(link.og_description)}</dd></div>`:''}
      </dl>
      ${link.og_image?`<img class="link-detail-image" src="${escapeHtml(link.og_image)}" alt="Gambar pratinjau link" />`:''}
      <div class="link-detail-actions">
        <button type="button" class="btn btn-outline btn-edit-action" data-action="edit">Edit link</button>
        <button type="button" class="btn btn-outline btn-qr-action" data-action="qr">QR Code</button>
        <button type="button" class="btn btn-outline btn-view-stats-action" data-action="stats">Lihat statistik</button>
        <button type="button" class="btn btn-outline btn-pause-action" data-action="pause">${link.is_active===false?'Aktifkan link':'Jeda link'}</button>
        <button type="button" class="btn btn-outline delete btn-delete-action" data-action="delete">Hapus link</button>
      </div>`;
    for (const button of content.querySelectorAll('[data-action]')) button.onclick=()=>{
      const action=button.dataset.action;
      if (action==='copy') return copyToClipboard(shortUrl(link.slug),button);
      if (action==='edit') { closeLinkDetails();openEditLinkModal(link.id);return; }
      if (action==='qr') { closeLinkDetails();qrSelectedSlug=link.slug;location.hash='#qr-studio';updateQrStudio();return; }
      if (action==='stats') { closeLinkDetails();activeLinkFilter=link.slug;document.getElementById('selectLinkFilter').value=link.slug;location.hash='#analytics';renderAnalytics();return; }
      if (action==='pause') return saveAction(button,()=>persistLink({...link,is_active:link.is_active===false},link.id));
      if (action==='delete') return saveAction(button,async()=>{
        if (!confirm(`Hapus shortlink "/${link.slug}"?`)) return;
        if (cloudMode) await api(`/api/links?id=${encodeURIComponent(link.id)}`,{method:'DELETE'});
        links=links.filter(item=>item.id!==link.id);clicksHistory=clicksHistory.filter(c=>c.link_id!==link.id&&c.slug!==link.slug);
        if (activeLinkFilter===link.slug) activeLinkFilter='all';
        closeLinkDetails(false);saveLocalLinks();saveLocalClicks();renderAll();document.getElementById(currentView==='home'?'btnHomeCreate':currentView==='analytics'?'selectLinkFilter':'btnOpenCreateModal').focus();
        showToast('Tautan berhasil dihapus','info');
      });
    };
    if (focusedAction) content.querySelector(`[data-action="${focusedAction}"]`)?.focus();
  }

  // --- EDIT PREVIEW & LINK MODAL ---
  function openEditLinkModal(id) {
    const modal = document.getElementById('modalLink');
    const modalTitle = document.getElementById('modalLinkTitle');
    const hiddenId = document.getElementById('modalLinkId');
    const inputUrl = document.getElementById('modalDestUrl');
    const inputSlug = document.getElementById('modalSlug');
    const inputOgTitle = document.getElementById('modalOgTitle');
    const inputOgDesc = document.getElementById('modalOgDescription');
    const inputOgImg = document.getElementById('modalOgImage');

    if (!modal) return;

    if (id) {
      const link = links.find(l => l.id === id);
      if (!link) return;
      if (modalTitle) modalTitle.innerHTML = '<i class="fa-solid fa-image"></i> Edit tautan';
      if (hiddenId) hiddenId.value = link.id;
      if (inputUrl) inputUrl.value = link.destination_url;
      if (inputSlug) inputSlug.value = link.slug;
      if (inputOgTitle) inputOgTitle.value = link.og_title || link.title || '';
      if (inputOgDesc) inputOgDesc.value = link.og_description || '';
      if (inputOgImg) inputOgImg.value = link.og_image || '';
    } else {
      if (modalTitle) modalTitle.innerHTML = '<i class="fa-solid fa-plus"></i> Buat tautan';
      if (hiddenId) hiddenId.value = '';
      if (inputUrl) inputUrl.value = '';
      if (inputSlug) inputSlug.value = generateRandomSlug(6);
      if (inputOgTitle) inputOgTitle.value = '';
      if (inputOgDesc) inputOgDesc.value = '';
      if (inputOgImg) inputOgImg.value = '';
    }

    const existing = links.find(l => l.id === id);
    document.querySelector('.advanced-options').open = Boolean(existing && (existing.password || existing.has_password || existing.expires_at || existing.tags?.length));
    document.getElementById('modalPassword').value = '';
    document.getElementById('modalPassword').placeholder = (existing?.password || existing?.has_password) ? 'Biarkan kosong untuk mempertahankan password' : 'Tanpa password';
    document.getElementById('removePassword').checked = false;
    document.getElementById('modalExpires').value = existing?.expires_at ? new Date(new Date(existing.expires_at).getTime() - new Date(existing.expires_at).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '';
    document.getElementById('modalTags').value = (existing?.tags || []).join(', ');
    document.getElementById('modalActive').checked = existing?.is_active !== false;
    ['utmSource', 'utmMedium', 'utmCampaign'].forEach(field => document.getElementById(field).value = '');
    document.getElementById('manualImageUrlInput').value = existing?.og_image?.startsWith('http') ? existing.og_image : '';
    updateUploadPreview();
    updateWhatsAppMockup();
    returnFocus = document.getElementById('sidSidebar').classList.contains('open') ? document.getElementById('btnMobileMenuToggle') : document.activeElement;
    closeMenu();
    modal.style.display = 'flex';
    document.body.classList.add('modal-open');
    inputUrl.focus();
  }

  function updateWhatsAppMockup() {
    const inputTitle = document.getElementById('modalOgTitle');
    const inputDesc = document.getElementById('modalOgDescription');
    const inputSlug = document.getElementById('modalSlug');
    const inputImg = document.getElementById('modalOgImage');

    const previewTitle = document.getElementById('waPreviewTitle');
    const previewDesc = document.getElementById('waPreviewDesc');
    const previewTextLink = document.getElementById('waPreviewTextLink');
    const previewImg = document.getElementById('waPreviewImg');
    const previewDomain = document.getElementById('waPreviewDomain');

    const titleVal = (inputTitle && inputTitle.value.trim()) || 'PROMO SPESIAL HARI INI!';
    const descVal = (inputDesc && inputDesc.value.trim()) || 'Klik tautan untuk melihat penawaran menarik.';
    const slugVal = (inputSlug && inputSlug.value.trim()) || 'link';
    const imgVal = (inputImg && inputImg.value.trim()) || '';

    if (previewTitle) previewTitle.textContent = titleVal;
    if (previewDesc) previewDesc.textContent = descVal;
    if (previewTextLink) {
      previewTextLink.textContent = shortUrl(slugVal);
      previewTextLink.href = shortUrl(slugVal);
    }
    if (previewImg) { previewImg.src = imgVal || ''; document.getElementById('waPreviewImgWrap').style.display = imgVal ? 'block' : 'none'; }
    if (previewDomain) previewDomain.textContent = customDomain.toUpperCase();
  }

  // --- EVENT LISTENERS INITIALIZATION ---
  function initEventListeners() {
    // Modal Link save
    const formModalLink = document.getElementById('formLinkModal');
    if (formModalLink) {
      formModalLink.addEventListener('submit', (e) => {
        e.preventDefault();
        saveAction(document.getElementById('btnSaveModalLink'), async () => {
          const id = document.getElementById('modalLinkId').value;
          const record = {
            destination_url: document.getElementById('modalDestUrl').value,
            slug: document.getElementById('modalSlug').value,
            og_title: document.getElementById('modalOgTitle').value,
            og_description: document.getElementById('modalOgDescription').value,
            og_image: document.getElementById('modalOgImage').value,
            password: document.getElementById('modalPassword').value,
            expires_at: document.getElementById('modalExpires').value || null,
            tags: document.getElementById('modalTags').value,
            is_active: document.getElementById('modalActive').checked
          };
          const existing = links.find(l => l.id === id);
          if (!record.password && !document.getElementById('removePassword').checked && id) {
            if (cloudMode) delete record.password;
            else record.password = existing?.password || null;
          }
          if (document.getElementById('removePassword').checked) record.password = null;
          const url = new URL(normalizeUrl(record.destination_url));
          [['utm_source','utmSource'],['utm_medium','utmMedium'],['utm_campaign','utmCampaign']].forEach(([key, field]) => {
            const value = document.getElementById(field).value.trim();
            if (value) url.searchParams.set(key, value);
          });
          record.destination_url = url.href;
          const saved = await persistLink(record, id || null);
          closeModal();
          openLinkDetails(saved.id);
        });
      });
    }

    // Modal Close
    const modalLink = document.getElementById('modalLink');
    if (modalLink) {
      modalLink.querySelectorAll('.modal-close, #btnCancelModalLink').forEach(btn => {
        btn.onclick = closeModal;
      });
    }

    // Header Quick Test Buttons
    // Refresh Analytics
    const btnRefresh = document.getElementById('btnRefreshAnalytics');
    if (btnRefresh) {
      btnRefresh.addEventListener('click', refreshAnalyticsData);
    }

    // Export PDF
    const btnExport = document.getElementById('btnExportPdf');
    if (btnExport) {
      btnExport.addEventListener('click', () => {
        window.print();
      });
    }

    // Download CSV
    const btnDownloadCsv = document.getElementById('btnDownloadCsv');
    if (btnDownloadCsv) {
      btnDownloadCsv.addEventListener('click', () => {
        exportClicksCsv();
      });
    }

    // Filter by link dropdown change
    const selFilter = document.getElementById('selectLinkFilter');
    if (selFilter) {
      selFilter.addEventListener('change', () => {
        activeLinkFilter = selFilter.value;
        renderAnalytics();
      });
    }

    // Randomize slug button
    const btnRandSlug = document.getElementById('btnRandomizeSlug');
    if (btnRandSlug) {
      btnRandSlug.addEventListener('click', () => {
        const input = document.getElementById('modalSlug');
        if (input) {
          input.value = generateRandomSlug(6);
          updateWhatsAppMockup();
        }
      });
    }

    // Real-time WA Preview typing
    ['modalOgTitle', 'modalOgDescription', 'modalOgImage', 'modalSlug'].forEach(id => {
      const input = document.getElementById(id);
      if (input) input.addEventListener('input', updateWhatsAppMockup);
    });

    // Mobile menu toggle
    const btnMobileMenu = document.getElementById('btnMobileMenuToggle');
    const sidebar = document.getElementById('sidSidebar');
    if (btnMobileMenu && sidebar) {
      btnMobileMenu.addEventListener('click', () => {
        const open = sidebar.classList.toggle('open');
        document.getElementById('menuBackdrop').hidden = !open;
        btnMobileMenu.setAttribute('aria-expanded', String(open));
        syncMenuAccessibility();
        if (open) document.getElementById('btnCloseSidebar').focus();
      });
    }

    // Sidebar & Header Create Link Buttons
    ['btnHomeCreate', 'btnSidebarCreateLink', 'btnOpenCreateModal'].forEach(id => {
      const btn = document.getElementById(id);
      if (btn) btn.onclick = () => openEditLinkModal(null);
    });

    // Header Domain Pill
    const btnTopDomain = document.getElementById('btnTopDomainModal');
    if (btnTopDomain) {
      btnTopDomain.onclick = () => {
        window.location.hash = '#domains';
      };
    }

    // Header Cloud Status Pill
    const btnTopCloud = document.getElementById('btnOpenCloudStatus');
    if (btnTopCloud) {
      btnTopCloud.onclick = () => {
        window.location.hash = '#settings';
      };
    }

    document.getElementById('btnConnectVercel').onclick = () => saveAction(document.getElementById('btnConnectVercel'), async () => {
      const input = document.getElementById('inputVercelToken');
      try {
        await api('/api/domain-integration', { method: 'POST', body: JSON.stringify({ token: input.value.trim() }) });
        await loadDomainManager();
        showToast('Vercel terhubung. Domain dapat dikelola dari dashboard.', 'success');
      } finally { input.value = ''; }
    });
    document.getElementById('btnDisconnectVercel').onclick = () => saveAction(document.getElementById('btnDisconnectVercel'), async () => {
      if (!confirm('Putus koneksi Vercel? Domain dan tautan tetap terpasang, tetapi pengelolaan domain membutuhkan koneksi ulang.')) return;
      await api('/api/domain-integration', { method: 'DELETE' });
      document.getElementById('domainDetails').hidden = true;
      await loadDomainManager();
    });
    document.getElementById('btnAddDomain').onclick = () => saveAction(document.getElementById('btnAddDomain'), async () => {
      const domain = document.getElementById('inputSettingsDomain').value.trim();
      document.getElementById('domainStatus').textContent = 'Menambahkan domain ke proyek AutoShort…';
      try {
        const result = await api('/api/domains', { method: 'POST', body: JSON.stringify({ action: 'add', domain }) });
        await loadDomainManager(); renderDomainDetails(result.domain);
        document.getElementById('domainStatus').textContent = 'Domain terpasang di proyek. Ikuti record DNS di bawah, lalu klik Periksa DNS & HTTPS.';
      } catch (error) { document.getElementById('domainStatus').textContent = error.message; throw error; }
    });
    document.getElementById('btnRefreshDomains').onclick = () => saveAction(document.getElementById('btnRefreshDomains'), loadDomainManager);

    // Settings: only persist a domain after the server verifies DNS, TLS and this backend.
    const domainStatus = document.getElementById('domainStatus');
    const btnSaveDomain = document.getElementById('btnSaveSettingsDomain');
    btnSaveDomain.onclick = () => saveAction(btnSaveDomain, async () => {
      domainStatus.textContent = 'Memeriksa DNS, HTTPS, dan koneksi ke aplikasi ini…';
      try {
        const result = await api('/api/domains', { method: 'POST', body: JSON.stringify({ domain: document.getElementById('inputSettingsDomain').value }) });
        customDomain = result.customDomain;
        updateDomainDisplays(); renderAll();
        domainStatus.textContent = `Aktif: ${customDomain}. Tersimpan di cloud untuk semua browser.`;
        if (vercelConnected) await loadDomainManager().catch(() => showToast('Domain tersimpan; daftar domain belum dapat dimuat ulang.', 'warning'));
        showToast('Domain terverifikasi dan tersimpan di cloud.', 'success');
      } catch (error) { domainStatus.textContent = error.message; throw error; }
    });
    const btnResetDomain = document.getElementById('btnResetSettingsDomain');
    btnResetDomain.onclick = () => saveAction(btnResetDomain, async () => {
      await api('/api/domains', { method: 'DELETE' });
      customDomain = platformDomain;
      updateDomainDisplays(); renderAll();
      if (vercelConnected) await loadDomainManager().catch(() => showToast('Domain direset; daftar domain belum dapat dimuat ulang.', 'warning'));
      domainStatus.textContent = 'Menggunakan domain bersama. Tautan dan domain Vercel tidak dihapus.';
      showToast('Domain akun dikembalikan ke domain bersama.', 'success');
    });
    const btnResetShared = document.getElementById('btnResetSharedDomain');
    if (btnResetShared) {
      btnResetShared.onclick = () => saveAction(btnResetShared, async () => {
        if (!confirm('Kembalikan domain utama bersama ke alamat default hosting?')) return;
        await api('/api/domains?scope=shared', { method: 'DELETE' });
        await fetchBackendConfig();
        await loadDomainManager();
        showToast('Domain utama bersama dikembalikan ke alamat hosting default.', 'success');
      });
    }
    document.getElementById('btnLogoutAdmin').onclick=()=>saveAction(document.getElementById('btnLogoutAdmin'),async()=>{
      await api('/api/auth?action=logout',{method:'POST',body:'{}'});clearAccountData();notifyAuthChange();updateAdminUI();updateDomainControls();renderAll();location.hash='#login';
    });
    document.getElementById('btnGoogleLogin').onclick=()=>location.assign('/api/auth?action=google');
    document.getElementById('authForm').onsubmit=async event=>{
      event.preventDefault();const button=document.getElementById('btnAuthSubmit');button.disabled=true;
      const password=document.getElementById('authPasswordInput'),confirmation=document.getElementById('authConfirmInput'),message=document.getElementById('authMessage');
      try{
        if(['signup','reset'].includes(authMode)&&password.value!==confirmation.value)throw new Error('Konfirmasi password belum sama.');
        const action=authMode==='reset'?'password':authMode;
        const result=await api('/api/auth?action='+action,{method:'POST',body:JSON.stringify({email:document.getElementById('authEmailInput').value,password:password.value})});
        if(result.user){clearAccountData();currentUser=result.user;adminConnected=true;notifyAuthChange();await fetchBackendConfig();location.hash='#home';}
        else if(authMode==='reset'){message.textContent='Password berhasil diperbarui.';showToast('Password berhasil diperbarui.','success');location.hash='#settings';}
        else message.textContent=result.message||'Periksa email Anda untuk melanjutkan.';
      }catch(error){message.textContent=error.message;}
      finally{password.value='';confirmation.value='';button.disabled=false;}
    };

    // Settings: Backup JSON
    const btnExportJson = document.getElementById('btnExportJsonBackup');
    if (btnExportJson) {
      btnExportJson.onclick = () => {
        const backupData = {
          links: links,
          clicks: clicksHistory,
          customDomain: customDomain,
          exportedAt: new Date().toISOString()
        };
        downloadFile(`autoshort-backup-${toISODate(new Date())}.json`, JSON.stringify(backupData, null, 2), 'application/json');
        showToast('Backup JSON berhasil diunduh!', 'success');
      };
    }

    // Settings: Reset Data
    const btnResetData = document.getElementById('btnResetAllData');
    if (btnResetData) {
      btnResetData.onclick = () => {
        if (cloudMode) return showToast('Untuk cloud, hapus tautan melalui menu Kelola Tautan. Reset hanya tersedia untuk data lokal.', 'warning');
        if (confirm('Apakah Anda yakin ingin menghapus seluruh data tautan dan statistik kunjungan?')) {
          localStorage.removeItem('autoshort_links');
          localStorage.removeItem('autoshort_clicks');
          localStorage.removeItem('autoshort_pure_real_mode');
          links = [];
          clicksHistory = [];
          saveLocalLinks();
          saveLocalClicks();
          renderAll();
          showToast('Seluruh data berhasil dibersihkan (kembali ke 0).', 'info');
        }
      };
    }
  }

  function downloadFile(name, content, type) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const a = document.createElement('a'); a.href = url; a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function updateUploadPreview() {
    const image = document.getElementById('modalOgImage').value;
    document.getElementById('dropzoneEmpty').style.display = image ? 'none' : 'block';
    document.getElementById('dropzoneActive').style.display = image ? 'block' : 'none';
    document.getElementById('dropzoneActiveThumb').src = image || '';
  }
  async function uploadImage(file) {
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return showToast('Gunakan gambar PNG, JPG, atau WebP.', 'warning');
    if (file.size > 1024 * 1024) return showToast('Ukuran gambar maksimal 1 MB.', 'warning');
    const reader = new FileReader();
    reader.onerror = () => showToast('Gambar gagal dibaca.', 'warning');
    reader.onload = () => { document.getElementById('modalOgImage').value = reader.result; updateUploadPreview(); updateWhatsAppMockup(); };
    reader.readAsDataURL(file);
  }
  function qrCanvas(size = Number(document.getElementById('qrResolution').value)) {
    if (!qrSelectedSlug || !links.some(l => l.slug === qrSelectedSlug)) throw new Error('Pilih tautan terlebih dahulu.');
    if (!window.QRCode) throw new Error('Generator QR belum tersedia. Muat ulang halaman.');
    const holder = document.createElement('div');
    new window.QRCode(holder, { text: shortUrl(qrSelectedSlug, true), width: size - 2 * Math.ceil(size / 16), height: size - 2 * Math.ceil(size / 16), colorDark: qrSelectedColor, colorLight: document.getElementById('qrBackground').value, correctLevel: window.QRCode.CorrectLevel.H });
    const canvas = document.createElement('canvas'); canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = document.getElementById('qrBackground').value; ctx.fillRect(0, 0, size, size);
    ctx.drawImage(holder.querySelector('canvas'), Math.ceil(size / 16), Math.ceil(size / 16));
    return canvas;
  }
  function initExtraControls() {
    document.querySelectorAll('.form-group').forEach(group => { const label = group.querySelector('label'); const field = group.querySelector('input:not([type=hidden]),textarea,select'); if (label && field?.id) label.htmlFor = field.id; });
    document.getElementById('menuBackdrop').onclick = () => closeMenu(true);
    document.getElementById('btnCloseSidebar').onclick = () => closeMenu(true);
    matchMedia('(max-width: 768px)').addEventListener('change', syncMenuAccessibility);
    syncMenuAccessibility();
    document.querySelectorAll('.nav-link').forEach(a => a.addEventListener('click', closeMenu));
    const modal = document.getElementById('modalLink');
    const detailsModal = document.getElementById('linkDetailsModal');
    document.getElementById('btnCloseLinkDetails').onclick=()=>closeLinkDetails();
    detailsModal.addEventListener('click',event=>{if(event.target===detailsModal)closeLinkDetails();});
    modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });
    document.addEventListener('pointerdown',e=>{if(!e.target.closest('#chartBarsTrack, #chartHoverDetail'))hideChartDetail();});
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') { hideChartDetail(); if (detailsModal.style.display!=='none') closeLinkDetails(); else closeModal(); closeMenu(true); document.getElementById('calendarPopup').style.display = 'none'; }
      if (e.key === '/' && !['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName) && modal.style.display === 'none' && detailsModal.style.display === 'none') {
        e.preventDefault(); location.hash = '#shortener'; document.getElementById('searchInput').focus();
      }
      const focusScope = modal.style.display !== 'none' ? modal : detailsModal.style.display !== 'none' ? detailsModal : document.getElementById('sidSidebar').classList.contains('open') ? document.getElementById('sidSidebar') : null;
      if (e.key === 'Tab' && focusScope) {
        const elements = [...focusScope.querySelectorAll('button,input,textarea,select,summary,a[href]')].filter(el => !el.disabled && el.offsetParent !== null);
        const first = elements[0], last = elements.at(-1);
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });
    document.getElementById('searchInput').oninput = e => { searchTerm = e.target.value.trim().toLowerCase(); renderShortenerLinks(); };
    const file = document.getElementById('modalFileInput');
    const drop = document.getElementById('uploadDropzone');
    drop.tabIndex = 0; drop.setAttribute('role', 'button'); drop.setAttribute('aria-label', 'Unggah gambar preview');
    drop.onclick = e => { if (!e.target.closest('button')) file.click(); };
    drop.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); file.click(); } };
    file.onclick = e => e.stopPropagation();
    file.onchange = () => { uploadImage(file.files[0]); file.value = ''; };
    drop.ondragover = e => { e.preventDefault(); drop.classList.add('dragging'); };
    drop.ondragleave = () => drop.classList.remove('dragging');
    drop.ondrop = e => { e.preventDefault(); drop.classList.remove('dragging'); uploadImage(e.dataTransfer.files[0]); };
    document.getElementById('btnDropzoneChange').onclick = () => file.click();
    document.getElementById('btnDropzoneRemove').onclick = () => { document.getElementById('modalOgImage').value = ''; document.getElementById('manualImageUrlInput').value = ''; updateUploadPreview(); updateWhatsAppMockup(); };
    document.getElementById('btnToggleManualUrl').onclick = () => {
      const group = document.getElementById('manualUrlGroup'); group.style.display = group.style.display === 'none' ? 'block' : 'none';
    };
    document.getElementById('manualImageUrlInput').oninput = e => { document.getElementById('modalOgImage').value = e.target.value.trim(); updateUploadPreview(); updateWhatsAppMockup(); };
    document.getElementById('qrBackground').oninput = updateQrStudio;
    document.getElementById('btnCopyQr').onclick = async () => {
      try {
        if (!navigator.clipboard?.write || !window.ClipboardItem) throw new Error('Browser belum mendukung salin gambar. Gunakan Unduh PNG.');
        const canvas = qrCanvas();
        const blob = new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        showToast('Gambar QR tersalin.', 'success');
      } catch (error) { showToast(error.message, 'warning'); }
    };
    document.getElementById('btnExportLinks').onclick = () => {
      const rows = [['Judul', 'Slug', 'Short URL', 'Tujuan', 'Klik', 'Status', 'Tag']];
      links.forEach(l => rows.push([l.title, l.slug, shortUrl(l.slug), l.destination_url, l.clicks, linkState(l), (l.tags || []).join(', ')]));
      downloadFile('autoshort-links.csv', '\ufeff' + rows.map(row => row.map(csvCell).join(',')).join('\r\n'), 'text/csv;charset=utf-8');
    };
    document.getElementById('btnImportBackup').onclick = () => document.getElementById('inputImportBackup').click();
    document.getElementById('inputImportBackup').onchange = async e => {
      try {
        await backendReady;
        if (cloudMode) throw new Error('Pemulihan JSON tersedia dalam mode lokal. Data cloud dikelola melalui database.');
        const file = e.target.files[0]; if (!file) return;
        if (file.size > 10000000) throw new Error('Cadangan maksimal 10 MB.');
        const backup = JSON.parse(await file.text());
        if (!Array.isArray(backup.links) || !Array.isArray(backup.clicks)) throw new Error('Format cadangan tidak valid.');
        const imported = backup.links.map(l => ({ ...normalizeLink(l), id: String(l.id || crypto.randomUUID()), clicks: Number(l.clicks) || 0, created_at: l.created_at || new Date().toISOString() }));
        if (new Set(imported.map(l => l.slug)).size !== imported.length || new Set(imported.map(l => l.id)).size !== imported.length) throw new Error('Slug atau ID dalam cadangan duplikat.');
        if (!confirm('Ganti data lokal dengan cadangan ini?')) return;
        const importedClicks = backup.clicks.filter(c => c && Number.isFinite(new Date(c.clicked_at).getTime())).map(c => ({
          id: String(c.id || crypto.randomUUID()), link_id: String(c.link_id || ''), slug: normalizeSlug(c.slug),
          visitor_id: String(c.visitor_id || c.id || crypto.randomUUID()), is_qr: c.is_qr === true,
          referer: String(c.referer || 'Direct'), country: String(c.country || 'Unknown'), city: String(c.city || 'Unknown'),
          user_agent: String(c.user_agent || ''), clicked_at: new Date(c.clicked_at).toISOString()
        }));
        links = imported; clicksHistory = importedClicks;
        saveLocalLinks(); saveLocalClicks(); renderAll(); showToast('Cadangan berhasil dipulihkan.', 'success');
      } catch (error) { showToast(error.message, 'warning'); }
      finally { e.target.value = ''; }
    };
  }

  // --- CSV EXPORT FUNCTION ---
  function exportClicksCsv() {
    const startISO = toISODate(selectedStartDate);
    const endISO = toISODate(selectedEndDate);

    const filtered = clicksHistory.filter(c => {
      if (!c.clicked_at) return false;
      const cDate = toISODate(new Date(c.clicked_at));
      return cDate >= startISO && cDate <= endISO;
    });

    if (filtered.length === 0) {
      showToast('Tidak ada data klik pada rentang tanggal ini untuk diunduh.', 'warning');
      return;
    }

    const rows = [['Timestamp', 'Slug', 'Visitor ID', 'Referrer', 'Is QR Scan', 'Device', 'Country']];
    filtered.filter(c => activeLinkFilter === 'all' || c.slug === activeLinkFilter || c.link_id === links.find(l => l.slug === activeLinkFilter)?.id).forEach(c => rows.push([
      c.clicked_at, c.slug, c.visitor_id, c.referer || 'Direct', c.is_qr ? 'Yes' : 'No', c.user_agent, c.country || 'Unknown'
    ]));
    downloadFile('analytics-clicks-' + startISO + '-to-' + endISO + '.csv', '\ufeff' + rows.map(row => row.map(csvCell).join(',')).join('\r\n'), 'text/csv;charset=utf-8');

    showToast('File CSV statistik berhasil diunduh!', 'success');
  }

  function updateAdminUI() {
    const notice=document.getElementById('storageNotice');notice.hidden=cloudMode&&adminConnected;notice.replaceChildren();
    const message=document.createElement('span');message.textContent=cloudMode?'Masuk untuk mengakses tautan dan statistik pribadi Anda.':'Mode lokal · Tautan disimpan di browser ini.';notice.append(message);
    if(cloudMode&&!adminConnected){const link=document.createElement('a');link.href='#login';link.textContent='Masuk / Daftar';notice.append(link);}
    for(const id of ['btnHomeCreate','btnOpenCreateModal','btnSidebarCreateLink','btnSaveModalLink'])document.getElementById(id).disabled=cloudMode&&!adminConnected;
    document.getElementById('userNameLabel').textContent=currentUser?.email||'Ruang kerja Anda';
    document.getElementById('userRoleLabel').textContent=cloudMode?(adminConnected?'Akun pribadi':'Belum masuk'):'Mode lokal';
    document.getElementById('accountSignedOut').hidden=adminConnected;
    document.getElementById('accountSignedIn').hidden=!adminConnected;
    document.getElementById('accountEmail').textContent=currentUser?.email||'';
    document.getElementById('accountSessionStatus').textContent=cloudMode?(adminConnected?'Anda masuk. Data tersimpan secara pribadi di akun Anda.':'Masuk atau daftar untuk menyimpan data pribadi.'): 'Akun tersedia dalam mode cloud. Data lokal tetap berada di browser ini.';
    document.getElementById('vercelConnectionPanel').hidden=!currentUser?.isOperator;
    document.getElementById('btnExportJsonBackup').disabled=cloudMode&&!adminConnected;
  }
  function clearAccountData() {
    syncPromise=null;domainsLoadedFor=null;currentUser=null;adminConnected=false;links=[];clicksHistory=[];selectedLinkId=null;searchTerm='';activeLinkFilter='all';vercelConnected=false;vercelManagedByServer=false;customDomain=platformDomain;
    document.getElementById('searchInput').value='';document.getElementById('domainList').replaceChildren();document.getElementById('domainDetails').hidden=true;document.getElementById('inputVercelToken').value='';
    document.getElementById('linkDetailsModal').style.display='none';document.getElementById('modalLink').style.display='none';document.body.classList.remove('modal-open');
    updateDomainDisplays();updateAdminUI();updateDomainControls();renderAll();
  }
  function notifyAuthChange(){try{localStorage.setItem('autoshort_auth_event',String(Date.now())+'-'+Math.random());}catch{}}
  async function consumeAuthCallback() {
    const params=new URLSearchParams(location.hash.slice(1));
    if(!params.has('refresh_token'))return;
    const refresh=params.get('refresh_token'),recovery=params.get('type')==='recovery';
    history.replaceState(null,'',location.pathname+(recovery?'#reset':'#home'));
    try{await api('/api/auth?action=session',{method:'POST',body:JSON.stringify({refresh_token:refresh})});notifyAuthChange();}
    catch{history.replaceState(null,'',location.pathname+'?auth_error=session#login');}
  }
  function renderAuthForm() {
    const modes={login:['Masuk','Masuk untuk mengelola tautan dan statistik pribadi Anda.','Masuk'],signup:['Buat akun','Daftar untuk menyimpan tautan dan statistik di akun Anda sendiri.','Daftar akun'],recover:['Lupa password','Kami akan mengirim tautan pemulihan ke email akun Anda.','Kirim tautan reset'],reset:['Ubah password','Gunakan password baru minimal 8 karakter.','Simpan password']};
    const [title,description,submit]=modes[authMode];
    document.getElementById('authTitle').textContent=title;document.getElementById('authDescription').textContent=description;document.getElementById('btnAuthSubmit').textContent=submit;
    document.getElementById('authEmailGroup').hidden=authMode==='reset';document.getElementById('authEmailInput').disabled=authMode==='reset';
    document.getElementById('authPasswordGroup').hidden=authMode==='recover';document.getElementById('authPasswordInput').disabled=authMode==='recover';document.getElementById('authPasswordInput').autocomplete=authMode==='login'?'current-password':'new-password';
    document.getElementById('authConfirmGroup').hidden=!['signup','reset'].includes(authMode);document.getElementById('authConfirmInput').required=['signup','reset'].includes(authMode);document.getElementById('authConfirmInput').disabled=!['signup','reset'].includes(authMode);
    document.getElementById('authTabs').hidden=!['login','signup'].includes(authMode);
    document.querySelectorAll('[data-auth-mode]').forEach(link=>link.classList.toggle('active',link.dataset.authMode===authMode));
    const google=cloudMode&&googleEnabled&&['login','signup'].includes(authMode);document.getElementById('btnGoogleLogin').hidden=!google;document.getElementById('authDivider').hidden=!google;
    document.getElementById('authMessage').textContent=location.search.includes('auth_error=')?'Login belum selesai. Silakan coba lagi.':'';
    document.getElementById('btnAuthSubmit').disabled=!cloudMode;
  }

  let currentSharedDomain = '';
  function updateDomainControls() {
    const enabled = cloudMode && adminConnected;
    for (const id of ['btnSaveSettingsDomain', 'btnResetSettingsDomain']) document.getElementById(id).disabled = !enabled;
    document.getElementById('btnConnectVercel').disabled = !enabled || vercelManagedByServer || !currentUser?.isOperator;
    document.getElementById('inputVercelToken').disabled = !enabled || vercelManagedByServer || !currentUser?.isOperator;
    for (const id of ['btnAddDomain', 'btnRefreshDomains']) document.getElementById(id).disabled = !enabled || !vercelConnected;
    document.getElementById('btnDisconnectVercel').disabled = !enabled || !vercelConnected || vercelManagedByServer;
  }
  async function loadDomainManager() {
    if (!cloudMode || !adminConnected) return;
    const accountId=currentUser?.id;
    let result;
    try { result = await api('/api/domains'); }
    catch (error) { document.getElementById('vercelIntegrationStatus').textContent = error.message; throw error; }
    if(currentUser?.id!==accountId)return;
    vercelConnected = result.connected === true;
    vercelManagedByServer = result.managedByServer === true;
    currentSharedDomain = result.sharedDomain || '';
    const sharedSection = document.getElementById('sharedDomainOwnerSection');
    if (sharedSection) {
      sharedSection.hidden = !result.canManageShared;
      const display = document.getElementById('currentSharedDomainDisplay');
      if (display) display.textContent = currentSharedDomain || '(Default hosting: ' + platformDomain + ')';
    }
    updateDomainControls();
    document.getElementById('vercelConnectionPanel').open = !vercelConnected;
    document.getElementById('vercelConnectionPanel').hidden=!currentUser?.isOperator;
    document.getElementById('vercelIntegrationStatus').textContent = vercelConnected
      ? 'Vercel terhubung. Penambahan, pemeriksaan, dan pelepasan domain dilakukan dari dashboard ini.'
      : currentUser?.isOperator?'Hubungkan secret token Vercel satu kali untuk mengaktifkan domain pengguna.':'Pengelola belum mengaktifkan custom domain. Anda tetap bisa memakai alamat bersama.';
    const container = document.getElementById('domainList');
    container.replaceChildren();
    for (const domain of result.domains || []) {
      const item = document.createElement('div'); item.className = 'domain-item';
      const name = document.createElement('strong'); name.textContent = domain.name; item.append(name);
      const state = document.createElement('p');
      state.textContent = domain.shared?'Domain bersama · tersedia untuk semua pengguna':domain.name === result.customDomain ? 'Domain utama' : domain.redirect ? `Mengalihkan ke ${domain.redirect}` : domain.verified ? 'Kepemilikan terverifikasi · Periksa DNS & HTTPS untuk kesiapan' : 'Menunggu verifikasi kepemilikan'; item.append(state);
      const actions = document.createElement('div'); actions.className = 'domain-actions'; item.append(actions);
      if(domain.shared){container.append(item);continue;}
      const inspect = document.createElement('button'); inspect.className = 'btn btn-outline btn-sm'; inspect.textContent = 'Periksa DNS & HTTPS';
      inspect.onclick = () => saveAction(inspect, async () => {
        document.getElementById('inputSettingsDomain').value = domain.name;
        const result = await api('/api/domains', {method:'POST',body:JSON.stringify({action:'check',domain:domain.name})});
        renderDomainDetails(result.domain);
      }); actions.append(inspect);
      const select = document.createElement('button'); select.className = 'btn btn-outline btn-sm'; select.textContent = 'Pilih Domain';
      select.onclick = () => { document.getElementById('inputSettingsDomain').value = domain.name; document.getElementById('inputSettingsDomain').focus(); }; actions.append(select);
      if (!domain.platform && domain.name !== result.customDomain && domain.name !== location.hostname) {
        const remove = document.createElement('button'); remove.className = 'btn btn-outline btn-sm'; remove.textContent = 'Lepas Domain';
        remove.onclick = () => saveAction(remove, async () => {
          if (!confirm(`Lepas ${domain.name} dari proyek? Semua shortlink pada hostname ini akan berhenti bekerja. Data tautan tidak dihapus.`)) return;
          await api('/api/domains?domain='+encodeURIComponent(domain.name), {method:'DELETE'});
          document.getElementById('domainDetails').hidden=true;
          await loadDomainManager(); showToast('Domain dilepas. Data tautan tetap tersimpan.', 'success');
        }); actions.append(remove);
      }
      container.append(item);
    }
  }
  function renderDomainDetails(domain) {
    const root = document.getElementById('domainDetails'); root.replaceChildren(); root.hidden = false;
    const title = document.createElement('strong'); title.textContent = 'Konfigurasi ' + domain.name; root.append(title);
    const state = document.createElement('p');
    state.textContent = domain.redirect ? `Domain mengalihkan ke ${domain.redirect}. Pilih hostname tujuan sebagai domain utama.`
      : domain.httpsReady ? 'DNS, HTTPS, dan backend siap. Domain dapat dijadikan domain utama.'
      : !domain.verified ? 'Verifikasi kepemilikan diperlukan. Tambahkan record verifikasi di bawah.'
      : domain.misconfigured ? 'DNS belum sesuai. Perbarui record di penyedia DNS, lalu periksa ulang.'
      : domain.readinessError || 'DNS sesuai. Klik Periksa DNS & HTTPS untuk memeriksa kesiapan sertifikat dan aplikasi.';
    root.append(state);
    if (domain.redirect) {
      const clear = document.createElement('button'); clear.className = 'btn btn-outline btn-sm'; clear.textContent = 'Gunakan Tanpa Pengalihan';
      clear.onclick = () => saveAction(clear, async () => {
        if (!confirm(`Hapus pengalihan ${domain.name} ke ${domain.redirect}? Domain ini akan menyajikan AutoShort langsung.`)) return;
        const result = await api('/api/domains', {method:'POST',body:JSON.stringify({action:'clear_redirect',domain:domain.name})});
        await loadDomainManager(); renderDomainDetails(result.domain);
      }); root.append(clear);
    }
    if(domain.dnsZone){const zone=document.createElement('p');zone.textContent='Pasang record di zona DNS '+domain.dnsZone+'. Gunakan Nama/Host dan Nilai di bawah; TTL Auto/default (misal 300 atau 14400 detik). Di Cloudflare, atur Proxy ke DNS only.';root.append(zone);}
    if (domain.nameservers?.length) { const p=document.createElement('p');p.textContent='Nameserver terdeteksi: '+domain.nameservers.join(', ')+'. Jika DNS dikelola penyedia lain (seperti Domainesia/Cloudflare), pasang record di penyedia nameserver aktif tersebut.';root.append(p); }
    for(const record of domain.dns || []) {
      const row=document.createElement('div');row.className='domain-record';
      const label=document.createElement('strong');const host=domain.dnsZone&&(record.name===domain.dnsZone||record.name.endsWith('.'+domain.dnsZone))?(record.name===domain.dnsZone?'@':record.name.slice(0,-domain.dnsZone.length-1)):record.name;label.textContent=record.type+(record.purpose==='ownership'?' · Verifikasi kepemilikan':' · Arahkan domain');row.append(label);
      const hostname=document.createElement('p');hostname.textContent='Nama / Host: '+host+(host==='@'?' (Domain utama)':' (Subdomain)');row.append(hostname);
      const copyHost=document.createElement('button');copyHost.className='btn btn-outline btn-sm';copyHost.textContent='Salin Nama';copyHost.onclick=()=>copyToClipboard(host,copyHost);row.append(copyHost);
      const ttl=document.createElement('p');ttl.style.fontSize='0.8rem';ttl.style.color='var(--text-muted,#888)';ttl.textContent='TTL: Auto / default penyedia';row.append(ttl);
      const value=document.createElement('code');value.textContent=record.value;row.append(value);
      const copy=document.createElement('button');copy.className='btn btn-outline btn-sm';copy.textContent='Salin Nilai';copy.onclick=()=>copyToClipboard(record.value,copy);row.append(copy);root.append(row);
    }
    if (!domain.dns?.length) {const p=document.createElement('p');p.textContent='Vercel belum memberikan rekomendasi record DNS untuk domain ini. Periksa kembali setelah proses pemasangan selesai.';root.append(p);}
    if (domain.conflicts?.length) {const p=document.createElement('p');p.textContent='Ada record DNS yang bertentangan. Sesuaikan record hostname ini dengan rekomendasi di atas tanpa mengubah record domain lain.';root.append(p);}
    const check=document.createElement('button');check.className='btn btn-outline btn-sm';check.textContent='Periksa DNS & HTTPS';
    check.onclick=()=>saveAction(check,async()=>{const result=await api('/api/domains',{method:'POST',body:JSON.stringify({action:'check',domain:domain.name})});renderDomainDetails(result.domain);await loadDomainManager();});root.append(check);
    if(domain.httpsReady&&!domain.redirect){
      const activate=document.createElement('button');activate.className='btn btn-primary btn-sm';activate.textContent='Jadikan Domain Pribadi Utama';
      activate.onclick=()=>saveAction(activate,async()=>{
        const result=await api('/api/domains',{method:'POST',body:JSON.stringify({action:'activate',domain:domain.name})});
        customDomain=result.customDomain;document.getElementById('inputSettingsDomain').value=customDomain;updateDomainDisplays();renderAll();await loadDomainManager();showToast('Domain utama akun Anda sudah aktif.','success');
      });root.append(activate);
      if (currentUser?.isOperator) {
        const setShared=document.createElement('button');setShared.className='btn btn-outline btn-sm';setShared.style.borderColor='#5146cb';setShared.textContent='Jadikan Domain Bersama (Semua Akun)';
        setShared.onclick=()=>saveAction(setShared,async()=>{
          if(!confirm(`Jadikan ${domain.name} sebagai domain utama bersama untuk semua pengguna AutoShort?`)) return;
          const result=await api('/api/domains',{method:'POST',body:JSON.stringify({action:'activate',domain:domain.name,scope:'shared'})});
          currentSharedDomain=result.sharedDomain;
          await fetchBackendConfig();await loadDomainManager();renderAll();showToast(`Domain utama bersama AutoShort berhasil diubah ke ${domain.name}.`,'success');
        });root.append(setShared);
      }
    }
  }

  function updateSettingsState() {
    for (const id of ['btnSaveSettingsDomain', 'btnResetSettingsDomain', 'inputSettingsDomain', 'btnLogoutAdmin']) document.getElementById(id).disabled = !cloudMode;
    document.getElementById('domainStatus').textContent = cloudMode
      ? 'Tambahkan domain, pasang record DNS yang ditampilkan, lalu periksa dan pilih domain utama di dashboard ini.'
      : 'Mode lokal: custom domain tidak tersedia. Tautan memakai alamat browser ini.';
    document.getElementById('btnExportJsonBackup').disabled = cloudMode && !adminConnected;
    document.getElementById('btnImportBackup').disabled = cloudMode;
    document.getElementById('btnResetAllData').disabled = cloudMode;
    document.getElementById('backupScope').textContent = cloudMode
      ? 'Backup mengunduh data cloud yang berhasil dimuat. Pemulihan dan reset lokal tidak tersedia dalam mode cloud.'
      : 'Backup, pulihkan, atau reset data lokal di browser ini.';
  }

  function updateDomainDisplays() {
    const addon = document.getElementById('modalDomainAddon');
    const topDomain = document.getElementById('topDomainText');
    const displayDomain = cloudMode ? customDomain : location.host;
    if (addon) addon.textContent = `${displayDomain}/`;
    if (topDomain) topDomain.textContent = displayDomain;
    const activeDomain = document.getElementById('activeDomainText');
    if (activeDomain) activeDomain.textContent = displayDomain;
  }

  function generateRandomSlug(length = 6) {
    const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
    let res = '';
    for (let i = 0; i < length; i++) {
      res += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return res;
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function copyToClipboard(text, btnElement) {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(() => showCopySuccess(btnElement)).catch(() => showToast('Salin otomatis ditolak browser. Pilih lalu salin tautannya secara manual.', 'warning'));
    } else {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      showCopySuccess(btnElement);
    }
  }

  function showCopySuccess(btn) {
    if (!btn) return;
    const orig = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-check" style="color:#10b981;"></i> Tersalin!';
    setTimeout(() => {
      btn.innerHTML = orig;
    }, 2000);
  }

  function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    let icon = '<i class="fa-solid fa-circle-info"></i>';
    if (type === 'success') icon = '<i class="fa-solid fa-circle-check" style="color:#10b981;"></i>';
    if (type === 'warning') icon = '<i class="fa-solid fa-triangle-exclamation" style="color:#f59e0b;"></i>';

    toast.innerHTML = `<div style="display:flex; align-items:center; gap:8px;">${icon} <span>${escapeHtml(message)}</span></div>`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      toast.style.transition = 'all 0.3s';
      setTimeout(() => toast.remove(), 300);
    }, 3200);
  }

})();
