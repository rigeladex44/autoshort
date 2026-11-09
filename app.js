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
  let vercelConnected = false;
  let vercelManagedByServer = false;
  let backendReady = Promise.resolve();
  let syncPromise = null;
  let saving = false;
  let searchTerm = '';
  let lastCreatedId = null;
  let returnFocus = null;
  const adminToken = () => sessionStorage.getItem('autoshort_admin_token') || '';
  function shortUrl(slug, qr = false) {
    const base = cloudMode ? (customDomain === location.host ? location.origin : `https://${customDomain}`) : location.origin;
    return `${base}/${encodeURIComponent(slug)}${qr ? '?src=qr' : ''}`;
  }
  async function api(path, options = {}) {
    const response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken()}`, ...options.headers } });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Permintaan server gagal.');
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
    if (lastCreatedId === id) { document.getElementById('quickResultUrl').href = shortUrl(saved.slug); document.getElementById('quickResultUrl').textContent = shortUrl(saved.slug); document.getElementById('quickResultTarget').textContent = `Menuju ke: ${saved.destination_url}`; }
    return saved;
  }
  function renderAll() {
    renderAnalytics(); renderShortenerLinks(); updateQuickResultDomain();
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
  let currentView = 'shortener';

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
  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('btnSkipToContent').onclick = () => [...document.querySelectorAll('main')].find(main => main.style.display !== 'none')?.focus();
    loadStoredData();
    initTheme();
    initCalendar();
    initEventListeners();
    initExtraControls();
    setupRouting();
    renderAnalytics();
    renderShortenerLinks();
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
    try { localStorage.setItem(cloudMode ? 'autoshort_cloud_links' : 'autoshort_links', JSON.stringify(links)); } catch { showToast('Opslag browser penuh atau tidak tersedia. Unduh cadangan data.', 'warning'); }
  }

  function saveLocalClicks() {
    try { localStorage.setItem(cloudMode ? 'autoshort_cloud_clicks' : 'autoshort_clicks', JSON.stringify(clicksHistory)); } catch { showToast('Riwayat tidak dapat disimpan di browser.', 'warning'); }
  }

  // --- REAL-TIME LISTENERS (CROSS-TAB & WEBSOCKET) ---
  // 1. Cross-tab real-time listener (fires instantly when someone visits link in another tab)
  window.addEventListener('storage', (e) => {
    if (cloudMode) return;
    if (e.key === 'autoshort_clicks' || e.key === 'autoshort_links') {
      const prevCount = clicksHistory.length;
      loadStoredData();
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
      const config = await api('/api/config');
      cloudMode = config.configured;
      if (cloudMode) { links = []; clicksHistory = []; renderAll(); }
      customDomain = config.customDomain || location.host;
      updateSettingsState();
      updateAdminUI();
      updateDomainDisplays();
      if (cloudMode) await syncWithBackend().catch(error => showToast(error.message, 'warning'));
      else status('Mode Lokal');
    } catch (error) {
      status('Server tidak terhubung');
      document.getElementById('storageNotice').hidden = false;
      document.getElementById('storageNotice').textContent = 'Konfigurasi server tidak dapat dimuat. Periksa koneksi lalu muat ulang sebelum membuat tautan.';
      throw error;
    }
    setInterval(() => { if (cloudMode && !document.hidden && !saving) syncWithBackend().catch(() => {}); }, 15000);
  }
  async function syncWithBackend() {
    if (!cloudMode) return;
    if (syncPromise) return syncPromise;
    syncPromise = (async () => {
      try {
        const [linkData, clickData, domainData] = await Promise.all([api('/api/links'), api('/api/analytics'), api('/api/config')]);
        if (customDomain !== (domainData.customDomain || location.host)) {
          customDomain = domainData.customDomain || location.host;
          updateDomainDisplays();
        }
        links = linkData.links || [];
        clicksHistory = clickData.recentClicks || [];
        const firstAdminSync = !adminConnected;
        adminConnected = true;
        updateAdminUI();
        saveLocalLinks(); saveLocalClicks(); renderAll();
        updateDomainControls();
        if (firstAdminSync) await loadDomainManager().catch(error => { document.getElementById('vercelIntegrationStatus').textContent = error.message; });
        document.getElementById('btnExportJsonBackup').disabled = false;
        document.getElementById('adminSessionStatus').textContent = 'Sesi admin aktif di tab ini.';
        status('Cloud Terhubung', true);
      } catch (error) { status('Cloud: perlu perhatian'); throw error; }
    })();
    try { await syncPromise; } finally { syncPromise = null; }
  }
  async function refreshAnalyticsData() {
    try { await backendReady; await syncWithBackend(); renderAll(); showToast('Data berhasil disegarkan.', 'success'); }
    catch (error) { showToast(error.message, 'warning'); }
  }

  // --- ROUTING / VIEW SWITCHING ---
  function setupRouting() {
    const handleHash = () => {
      const hash = window.location.hash.replace('#', '') || 'shortener';
      switchView(hash);
    };

    window.addEventListener('hashchange', handleHash);
    handleHash();
  }

  function switchView(viewName) {
    if (!['analytics', 'shortener', 'qr-studio', 'activity', 'domains', 'settings'].includes(viewName)) viewName = 'shortener';
    document.body.dataset.view = viewName;
    closeMenu();
    window.scrollTo(0, 0);
    currentView = viewName;
    const views = {
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

    if (viewName === 'shortener') {
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

    document.querySelectorAll('.cal-preset-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const preset = btn.getAttribute('data-preset');
        applyPreset(preset);
        document.querySelectorAll('.cal-preset-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        if (popup) popup.style.display = 'none';
        if (btnDropdown) btnDropdown.classList.remove('open');
      });
    });

    updateDateRangeButtonLabel();
  }

  function applyPreset(preset) {
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    tempRangeStart = null;
    let start = new Date(end);

    if (preset === '1') {
      start = new Date(end);
      start.setHours(0, 0, 0, 0);
    } else if (preset === '7') {
      start.setDate(end.getDate() - 6);
      start.setHours(0, 0, 0, 0);
    } else if (preset === '14') {
      start.setDate(end.getDate() - 13);
      start.setHours(0, 0, 0, 0);
    } else if (preset === '30') {
      start.setDate(end.getDate() - 29);
      start.setHours(0, 0, 0, 0);
    } else if (preset === 'month') {
      start = new Date(end.getFullYear(), end.getMonth(), 1);
    }

    selectedStartDate = start;
    updateDateRangeButtonLabel();
    renderAnalytics();
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
    el.textContent = `${format(selectedStartDate)} — ${format(selectedEndDate)}`;
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

    const totalLinksCount = links.length;
    const totalVisitors = filteredClicks.length;
    const uniqueVisitorSet = new Set();
    let qrVisitorCount = 0;

    filteredClicks.forEach(c => {
      const vId = c.visitor_id || (c.user_agent ? c.user_agent : ('v_' + c.id));
      uniqueVisitorSet.add(vId);

      if (c.is_qr || (c.referer && c.referer.toLowerCase().includes('qr'))) {
        qrVisitorCount++;
      }
    });

    const uniqueVisitors = uniqueVisitorSet.size;

    // Update KPI Card Numbers
    const elTotalLinks = document.getElementById('kpiTotalLinks');
    const elTotalVisitors = document.getElementById('kpiTotalVisitors');
    const elUniqueVisitors = document.getElementById('kpiUniqueVisitors');
    const elQrVisitors = document.getElementById('kpiQrVisitors');

    if (elTotalLinks) elTotalLinks.textContent = totalLinksCount.toLocaleString();
    if (elTotalVisitors) elTotalVisitors.textContent = totalVisitors.toLocaleString();
    if (elUniqueVisitors) elUniqueVisitors.textContent = uniqueVisitors.toLocaleString();
    if (elQrVisitors) elQrVisitors.textContent = qrVisitorCount.toLocaleString();

    // Build Daily Stacked Data for Chart
    const daysList = generateDateRangeList(selectedStartDate, selectedEndDate);
    const dailyMap = {};

    daysList.forEach(d => {
      dailyMap[d.iso] = {
        iso: d.iso,
        label: d.label,
        visitors: 0,
        uniqueSet: new Set(),
        qrCount: 0,
        referrers: {}
      };
    });

    filteredClicks.forEach(c => {
      const cDate = toISODate(new Date(c.clicked_at));
      if (dailyMap[cDate]) {
        dailyMap[cDate].visitors++;
        const vId = c.visitor_id || c.id;
        dailyMap[cDate].uniqueSet.add(vId);
        if (c.is_qr) dailyMap[cDate].qrCount++;

        const ref = c.referer || 'Direct';
        dailyMap[cDate].referrers[ref] = (dailyMap[cDate].referrers[ref] || 0) + 1;
      }
    });

    const chartData = daysList.map(d => {
      const item = dailyMap[d.iso];
      return {
        iso: d.iso,
        label: d.label,
        visitors: item.visitors,
        unique: item.uniqueSet.size,
        qr: item.qrCount,
        topRef: getTopKey(item.referrers)
      };
    });

    renderStackedBarChart(chartData);
    renderPerformanceTable(filteredClicks);
    renderDeepDiveBreakdowns(filteredClicks);
  }

  function generateDateRangeList(start, end) {
    const list = [];
    const curr = new Date(start);
    curr.setHours(0, 0, 0, 0);

    const endNormalized = new Date(end);
    endNormalized.setHours(0, 0, 0, 0);

    while (curr <= endNormalized) {
      const iso = toISODate(curr);
      const day = curr.getDate();
      const month = curr.toLocaleDateString('id-ID', { month: 'short' });
      const year = String(curr.getFullYear()).slice(-2);
      list.push({
        iso: iso,
        label: `${day} ${month} ${year}`
      });
      curr.setDate(curr.getDate() + 1);
    }
    return list;
  }

  function getTopKey(obj) {
    let top = 'Direct';
    let max = 0;
    Object.keys(obj).forEach(k => {
      if (obj[k] > max) {
        max = obj[k];
        top = k;
      }
    });
    return top;
  }

  // --- STACKED BAR CHART RENDERING ---
  function renderStackedBarChart(chartData) {
    const track = document.getElementById('chartBarsTrack');
    const yAxisTop = document.getElementById('yAxisTop');
    const yAxisMid = document.getElementById('yAxisMid');
    if (!track) return;

    track.innerHTML = '';

    const maxDayTotal = Math.max(...chartData.map(d => d.visitors), 1);
    const magnitude = 10 ** Math.floor(Math.log10(maxDayTotal));
    const scaleMax = ([2, 4, 6, 8, 10].find(step => step * magnitude >= maxDayTotal) || 10) * magnitude;
    const scaleMid = Math.round(scaleMax / 2);

    if (yAxisTop) yAxisTop.textContent = scaleMax;
    if (yAxisMid) yAxisMid.textContent = scaleMid;

    const labelStep = Math.ceil(chartData.length / (window.innerWidth <= 768 ? 4 : 10));
    chartData.forEach((d, index) => {
      const col = document.createElement('div');
      col.className = 'chart-bar-column';
      col.tabIndex = 0;
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
        <span class="bar-date-label" style="visibility:${index % labelStep === 0 ? 'visible' : 'hidden'}">${d.label.replace(/ \d{2}$/, '')}</span>
        
        <div class="chart-tooltip">
          <div style="font-weight:700; margin-bottom:4px; color:#fff;">${d.label}</div>
          <div style="display:flex; align-items:center; gap:6px; color:#ef4444;">
            <span class="dot-indicator dot-red"></span> Total Klik: <strong>${d.visitors}</strong>
          </div>
          <div style="display:flex; align-items:center; gap:6px; color:#8b5cf6;">
            <span class="dot-indicator dot-purple"></span> Pengunjung Unik: <strong>${d.unique}</strong>
          </div>
          <div style="display:flex; align-items:center; gap:6px; color:#06b6d4; font-size:0.7rem; margin-top:2px;">
            <span class="dot-indicator dot-cyan"></span> Scan QR: <strong>${d.qr}</strong>
          </div>
          <div style="color:#94a3b8; font-size:0.7rem; margin-top:4px;">
            Sumber Teratas: ${escapeHtml(d.topRef)}
          </div>
        </div>
      `;

      col.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); col.click(); } });
      col.addEventListener('click', () => {
        showToast(`Detail tanggal ${d.label}: ${d.visitors} kunjungan, ${d.unique} unik.`, 'info');
      });

      track.appendChild(col);
    });
  }

  // --- PERFORMANCE PER SHORTLINK TABLE ---
  function renderPerformanceTable(filteredClicks) {
    const tbody = document.getElementById('tableLinksAnalyticsBody');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (links.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="text-center" style="padding:20px; color:#9ca3af;">Belum ada shortlink yang dibuat.</td></tr>';
      return;
    }

    links.filter(l => activeLinkFilter === 'all' || l.slug === activeLinkFilter).forEach(link => {
      const linkClicks = filteredClicks.filter(c => c.link_id === link.id || c.slug === link.slug);
      const totalVis = linkClicks.length;

      const uSet = new Set();
      let qrVis = 0;
      const refCount = {};

      linkClicks.forEach(c => {
        uSet.add(c.visitor_id || c.id);
        if (c.is_qr || (c.referer && c.referer.toLowerCase().includes('qr'))) qrVis++;
        const r = c.referer || 'Direct';
        refCount[r] = (refCount[r] || 0) + 1;
      });

      const topSource = getTopKey(refCount);

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>
          <div style="font-weight:700; color:var(--text-main); font-size:0.9rem;">
            ${escapeHtml(link.title || link.slug)}
          </div>
          <div class="table-slug">
            <a href="${escapeHtml(shortUrl(link.slug))}" target="_blank">
              ${escapeHtml(cloudMode ? customDomain : location.host)}/${escapeHtml(link.slug)}
            </a>
          </div>
        </td>
        <td>
          <div class="table-dest" title="${escapeHtml(link.destination_url)}">
            ${escapeHtml(link.destination_url)}
          </div>
        </td>
        <td>
          <strong style="color:var(--text-main); font-size:0.95rem;">${totalVis}</strong>
        </td>
        <td>
          <span style="color:#8b5cf6; font-weight:700;">${uSet.size}</span>
        </td>
        <td>
          <span style="color:#06b6d4; font-weight:700;">${qrVis}</span>
        </td>
        <td>
          <span style="background:var(--bg-hover); padding:3px 8px; border-radius:4px; font-size:0.76rem;">${escapeHtml(topSource)}</span>
        </td>
        <td>
          <div style="display:flex; gap:6px;">
            <button class="btn btn-sm btn-outline btn-table-test-click" data-slug="${escapeHtml(link.slug)}" data-id="${escapeHtml(link.id)}" title="Kirim Klik Riil">
              <i class="fa-solid fa-play"></i> Klik
            </button>
            <button class="btn btn-sm btn-outline btn-table-qr" data-slug="${escapeHtml(link.slug)}" title="Buka di QR Studio">
              <i class="fa-solid fa-qrcode"></i> QR
            </button>
          </div>
        </td>
      `;

      tbody.appendChild(tr);
    });

    tbody.querySelectorAll('.btn-table-test-click').forEach(btn => {
      btn.onclick = () => {
        simulateRealClick(btn.getAttribute('data-slug'), btn.getAttribute('data-id'), false);
      };
    });

    tbody.querySelectorAll('.btn-table-qr').forEach(btn => {
      btn.onclick = () => {
        qrSelectedSlug = btn.getAttribute('data-slug');
        window.location.hash = '#qr-studio';
      };
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
    select.innerHTML = '<option value="all">Semua Tautan (Akumulasi)</option>';

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

  // --- SHORTENER VIEW MANAGEMENT ---
  function renderShortenerLinks() {
    const container = document.getElementById('linksCardsContainer');
    const badge = document.getElementById('linksCountBadge');
    const emptyState = document.getElementById('emptyState');
    if (!container) return;

    container.innerHTML = '';
    if (badge) badge.textContent = `${links.length} Tautan`;

    if (emptyState) {
      const needsAdmin = cloudMode && !adminConnected;
      emptyState.querySelector('h4').textContent = needsAdmin ? 'Tautan Anda tersimpan di cloud' : 'Belum ada tautan';
      const description = emptyState.querySelector('p');
      description.textContent = needsAdmin ? 'Masuk sebagai admin untuk melihat dan mengelola tautan. ' : 'Mulai dengan menempelkan URL tujuan pada formulir di atas.';
      if (needsAdmin) { const link = document.createElement('a'); link.href = '#settings'; link.textContent = 'Masuk admin'; description.append(link); }
    }
    if (links.length === 0) {
      if (emptyState) emptyState.style.display = 'block';
      return;
    }
    if (emptyState) emptyState.style.display = 'none';

    const visible = links.filter(l => [l.title, l.og_title, l.slug, l.destination_url, ...(l.tags || [])].join(' ').toLowerCase().includes(searchTerm));
    if (!visible.length) container.innerHTML = '<p class="search-empty">Tidak ada tautan yang cocok dengan pencarian.</p>';
    visible.forEach(link => {
      const card = document.createElement('div');
      card.className = 'link-card';

      const linkUrl = shortUrl(link.slug);
      const previewImg = link.og_image || '';
      const displayTitle = link.og_title || link.title || link.slug;

      card.innerHTML = `
        <div class="link-card-main">
          <div class="link-preview-thumb">
            ${previewImg ? `<img src="${escapeHtml(previewImg)}" alt="Thumb"/>` : `<i class="fa-solid fa-image" style="color:#94a3b8;"></i>`}
          </div>

          <div class="link-details">
            <span class="link-title">${escapeHtml(displayTitle)}</span>
            <div class="link-status-row"><span class="link-status status-${linkState(link)}">${({active:'Aktif',paused:'Dijeda',expired:'Kedaluwarsa',protected:'Dilindungi'})[linkState(link)]}</span>${(link.tags || []).map(t => `<span class="link-tag">${escapeHtml(t)}</span>`).join('')}</div>

            <div class="link-url-row">
              <a href="${escapeHtml(linkUrl)}" target="_blank" class="short-url-link">
                ${escapeHtml(cloudMode ? customDomain : location.host)}/${escapeHtml(link.slug)}
              </a>
              <button class="btn-inline-copy" data-url="${escapeHtml(linkUrl)}">
                <i class="fa-regular fa-copy"></i> Salin Link
              </button>
            </div>

            <div class="dest-url-truncate" title="${escapeHtml(link.destination_url)}">
              <i class="fa-solid fa-arrow-turn-up" style="transform: rotate(90deg); margin-right: 4px; font-size: 0.75rem;"></i>
              ${escapeHtml(link.destination_url)}
            </div>
          </div>
        </div>

        <div class="link-card-actions">
          <div class="clicks-badge">
            <span class="clicks-number">${(Number(link.clicks) || 0).toLocaleString()}</span>
            <span class="clicks-label">total klik</span>
          </div>

          <div class="action-buttons-group">
            <button class="btn-icon-action btn-pause-action" data-id="${escapeHtml(link.id)}" title="${link.is_active === false ? 'Aktifkan' : 'Jeda'} tautan"><i class="fa-solid ${link.is_active === false ? 'fa-play' : 'fa-pause'}"></i></button>
            <button class="btn-icon-action btn-qr-action" data-slug="${escapeHtml(link.slug)}" title="Buka di QR Studio">
              <i class="fa-solid fa-qrcode"></i>
            </button>
            <button class="btn-icon-action btn-edit-action" data-id="${escapeHtml(link.id)}" title="Edit tautan">
              <i class="fa-solid fa-image"></i>
            </button>
            <button class="btn-icon-action btn-view-stats-action" data-slug="${escapeHtml(link.slug)}" title="Buka Analisis Tautan Ini">
              <i class="fa-solid fa-chart-column"></i>
            </button>
            <button class="btn-icon-action delete btn-delete-action" data-id="${escapeHtml(link.id)}" data-slug="${escapeHtml(link.slug)}" title="Hapus Link">
              <i class="fa-regular fa-trash-can"></i>
            </button>
          </div>
        </div>
      `;

      container.appendChild(card);
    });

    container.querySelectorAll('.btn-inline-copy').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        copyToClipboard(btn.getAttribute('data-url'), btn);
      };
    });

    container.querySelectorAll('.btn-qr-action').forEach(btn => {
      btn.onclick = () => {
        qrSelectedSlug = btn.getAttribute('data-slug');
        window.location.hash = '#qr-studio';
      };
    });

    container.querySelectorAll('.btn-edit-action').forEach(btn => {
      btn.onclick = () => openEditLinkModal(btn.getAttribute('data-id'));
    });

    container.querySelectorAll('.btn-view-stats-action').forEach(btn => {
      btn.onclick = () => {
        activeLinkFilter = btn.getAttribute('data-slug');
        const sel = document.getElementById('selectLinkFilter');
        if (sel) sel.value = activeLinkFilter;
        window.location.hash = '#analytics';
      };
    });

    container.querySelectorAll('.btn-pause-action').forEach(btn => {
      btn.onclick = () => saveAction(btn, async () => { const link = links.find(l => l.id === btn.dataset.id); await persistLink({ ...link, is_active: link.is_active === false }, link.id); });
    });

    container.querySelectorAll('.btn-delete-action').forEach(btn => {
      btn.onclick = () => saveAction(btn, async () => {
        const id = btn.getAttribute('data-id');
        const slug = btn.getAttribute('data-slug');
        if (confirm(`Hapus shortlink "/${slug}"?`)) {
          if (cloudMode) await api(`/api/links?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
          links = links.filter(l => l.id !== id);
          clicksHistory = clicksHistory.filter(c => c.link_id !== id && c.slug !== slug);
          saveLocalLinks();
          saveLocalClicks();
          if (activeLinkFilter === slug) activeLinkFilter = 'all';
          if (lastCreatedId === id) document.getElementById('quickResultBanner').style.display = 'none';
          renderAll();
          showToast('Tautan berhasil dihapus', 'info');
        }
      });
    });
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
    const slugVal = (inputSlug && inputSlug.value.trim().toLowerCase()) || 'link';
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
    // Quick Shorten
    const quickForm = document.getElementById('quickShortenForm');
    if (quickForm) {
      quickForm.addEventListener('submit', (e) => {
        e.preventDefault();
        saveAction(document.getElementById('btnQuickSubmit'), async () => {
        const inputUrl = document.getElementById('quickUrlInput');
        const inputSlug = document.getElementById('quickSlugInput');
        if (!inputUrl || !inputUrl.value.trim()) return;

        const dest = normalizeUrl(inputUrl.value);

        let slug = inputSlug ? inputSlug.value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-') : '';
        if (!slug) slug = generateRandomSlug(6);

        if (links.some(l => l.slug.toLowerCase() === slug)) {
          showToast(`Slug "/${slug}" sudah digunakan. Gunakan slug lain.`, 'warning');
          return;
        }

        const newLink = {
          id: 'link_' + Date.now(),
          slug: slug,
          destination_url: dest,
          title: slug,
          og_title: slug.toUpperCase(),
          og_description: 'Lihat info lengkap di link ini.',
          og_image: '',
          clicks: 0,
          created_at: new Date().toISOString()
        };

        const saved = await persistLink(newLink);
        lastCreatedId = saved.id;

        const banner = document.getElementById('quickResultBanner');
        const resUrl = document.getElementById('quickResultUrl');
        const resDest = document.getElementById('quickResultTarget');
        if (banner) banner.style.display = 'flex';
        if (resUrl) {
          resUrl.textContent = shortUrl(slug);
          resUrl.href = shortUrl(slug);
        }
        if (resDest) resDest.textContent = `Menuju ke: ${dest}`;

        showToast('Shortlink berhasil dibuat!', 'success');
        inputUrl.value = '';
        if (inputSlug) inputSlug.value = '';
        });
      });
    }

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
    document.querySelector('.advanced-options').open = Boolean(existing && (existing.password || existing.has_password || existing.expires_at || existing.tags?.length));
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
          await persistLink(record, id || null);
          closeModal();
          showToast('Shortlink berhasil disimpan!', 'success');
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
    ['btnSidebarCreateLink', 'btnOpenCreateModal'].forEach(id => {
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
        updateDomainDisplays(); renderAll(); updateQuickResultDomain();
        domainStatus.textContent = `Aktif: ${customDomain}. Tersimpan di cloud untuk semua browser.`;
        if (vercelConnected) await loadDomainManager().catch(() => showToast('Domain tersimpan; daftar domain belum dapat dimuat ulang.', 'warning'));
        showToast('Domain terverifikasi dan tersimpan di cloud.', 'success');
      } catch (error) { domainStatus.textContent = error.message; throw error; }
    });
    const btnResetDomain = document.getElementById('btnResetSettingsDomain');
    btnResetDomain.onclick = () => saveAction(btnResetDomain, async () => {
      await api('/api/domains', { method: 'DELETE' });
      customDomain = location.host;
      updateDomainDisplays(); renderAll(); updateQuickResultDomain();
      if (vercelConnected) await loadDomainManager().catch(() => showToast('Domain direset; daftar domain belum dapat dimuat ulang.', 'warning'));
      domainStatus.textContent = 'Menggunakan alamat situs yang sedang dibuka. Tautan dan domain Vercel tidak dihapus.';
      showToast('Domain utama dikembalikan ke alamat situs.', 'success');
    });
    const btnAdmin = document.getElementById('btnSaveAdminToken');
    btnAdmin.onclick = () => saveAction(btnAdmin, async () => {
      const token = document.getElementById('inputAdminToken').value.trim();
      if (!token) throw new Error('Masukkan token admin.');
      const previous = adminToken();
      sessionStorage.setItem('autoshort_admin_token', token);
      try {
        await syncWithBackend();
        document.getElementById('inputAdminToken').value = '';
        await loadDomainManager().catch(error => { document.getElementById('vercelIntegrationStatus').textContent = error.message; });
        document.getElementById('adminSessionStatus').textContent = 'Sesi admin aktif di tab ini.';
        showToast('Token valid. Data cloud berhasil disinkronkan.', 'success');
      } catch (error) {
        if (previous) sessionStorage.setItem('autoshort_admin_token', previous);
        else sessionStorage.removeItem('autoshort_admin_token');
        document.getElementById('adminSessionStatus').textContent = error.message;
        throw error;
      }
    });
    document.getElementById('btnLogoutAdmin').onclick = () => {
      sessionStorage.removeItem('autoshort_admin_token');
      adminConnected = false;
      vercelConnected = false;
      document.getElementById('domainList').replaceChildren();
      document.getElementById('domainDetails').hidden = true;
      document.getElementById('inputVercelToken').value = '';
      document.getElementById('vercelIntegrationStatus').textContent = 'Masuk sebagai admin untuk mengelola domain.';
      updateDomainControls();
      localStorage.removeItem('autoshort_cloud_links');
      localStorage.removeItem('autoshort_cloud_clicks');
      document.getElementById('btnExportJsonBackup').disabled = cloudMode;
      document.getElementById('inputAdminToken').value = '';
      document.getElementById('adminSessionStatus').textContent = 'Sesi admin telah diakhiri.';
      updateAdminUI();
      if (cloudMode) { links = []; clicksHistory = []; renderAll(); status('Cloud: perlu token admin'); }
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
          document.getElementById('quickResultBanner').style.display = 'none';
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
    modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') { closeModal(); closeMenu(true); document.getElementById('calendarPopup').style.display = 'none'; }
      if (e.key === '/' && !['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName) && modal.style.display === 'none') {
        e.preventDefault(); location.hash = '#shortener'; document.getElementById('searchInput').focus();
      }
      const focusScope = modal.style.display !== 'none' ? modal : document.getElementById('sidSidebar').classList.contains('open') ? document.getElementById('sidSidebar') : null;
      if (e.key === 'Tab' && focusScope) {
        const elements = [...focusScope.querySelectorAll('button,input,textarea,select,summary,a[href]')].filter(el => !el.disabled && el.offsetParent !== null);
        const first = elements[0], last = elements.at(-1);
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });
    document.getElementById('searchInput').oninput = e => { searchTerm = e.target.value.trim().toLowerCase(); renderShortenerLinks(); };
    document.getElementById('btnToggleLinkView').onclick = e => {
      const pressed = document.getElementById('linksCardsContainer').classList.toggle('compact');
      e.currentTarget.setAttribute('aria-pressed', String(pressed));
      e.currentTarget.textContent = pressed ? 'Tampilan kartu' : 'Tampilan ringkas';
    };
    document.getElementById('btnCopyQuickResult').onclick = e => copyToClipboard(document.getElementById('quickResultUrl').href, e.currentTarget);
    document.getElementById('btnEditPreviewQuickResult').onclick = () => openEditLinkModal(lastCreatedId);
    document.getElementById('btnStatsQuickResult').onclick = () => {
      const link = links.find(l => l.id === lastCreatedId);
      if (link) { activeLinkFilter = link.slug; location.hash = '#analytics'; renderAnalytics(); }
    };
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
    const notice = document.getElementById('storageNotice');
    notice.hidden = cloudMode && adminConnected;
    notice.replaceChildren();
    const message = document.createElement('span');
    message.textContent = cloudMode ? 'Data cloud Anda siap. Masuk untuk mengelola tautan.' : 'Mode lokal · Tautan disimpan di browser ini.';
    notice.append(message);
    if (cloudMode && !adminConnected) {
      const link = document.createElement('a'); link.href = '#settings'; link.textContent = 'Masuk admin'; notice.append(link);
    }
    for (const id of ['btnQuickSubmit', 'btnOpenCreateModal', 'btnSidebarCreateLink', 'btnSaveModalLink']) document.getElementById(id).disabled = cloudMode && !adminConnected;
    document.getElementById('userRoleLabel').textContent = cloudMode ? (adminConnected ? 'Admin terhubung' : 'Mode cloud') : 'Mode lokal';
  }

  function updateDomainControls() {
    const enabled = cloudMode && adminConnected;
    for (const id of ['btnSaveSettingsDomain', 'btnResetSettingsDomain']) document.getElementById(id).disabled = !enabled;
    document.getElementById('btnConnectVercel').disabled = !enabled || vercelManagedByServer;
    document.getElementById('inputVercelToken').disabled = !enabled || vercelManagedByServer;
    for (const id of ['btnAddDomain', 'btnRefreshDomains']) document.getElementById(id).disabled = !enabled || !vercelConnected;
    document.getElementById('btnDisconnectVercel').disabled = !enabled || !vercelConnected || vercelManagedByServer;
  }
  async function loadDomainManager() {
    if (!cloudMode || !adminConnected) return;
    let result;
    try { result = await api('/api/domains'); }
    catch (error) { document.getElementById('vercelIntegrationStatus').textContent = error.message; throw error; }
    vercelConnected = result.connected === true;
    vercelManagedByServer = result.managedByServer === true;
    updateDomainControls();
    document.getElementById('vercelConnectionPanel').open = !vercelConnected;
    document.getElementById('vercelIntegrationStatus').textContent = vercelConnected
      ? 'Vercel terhubung. Penambahan, pemeriksaan, dan pelepasan domain dilakukan dari dashboard ini.'
      : 'Hubungkan secret token Vercel satu kali untuk menambahkan dan mengelola domain dari dashboard.';
    const container = document.getElementById('domainList');
    container.replaceChildren();
    for (const domain of result.domains || []) {
      const item = document.createElement('div'); item.className = 'domain-item';
      const name = document.createElement('strong'); name.textContent = domain.name; item.append(name);
      const state = document.createElement('p');
      state.textContent = domain.name === result.customDomain ? 'Domain utama' : domain.redirect ? `Mengalihkan ke ${domain.redirect}` : domain.verified ? 'Kepemilikan terverifikasi · Periksa DNS & HTTPS untuk kesiapan' : 'Menunggu verifikasi kepemilikan'; item.append(state);
      const actions = document.createElement('div'); actions.className = 'domain-actions'; item.append(actions);
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
    if (domain.nameservers?.length) { const p=document.createElement('p');p.textContent='Nameserver: '+domain.nameservers.join(', ')+'. Jika DNS dikelola penyedia lain, pasang record berikut di penyedia tersebut.';root.append(p); }
    for(const record of domain.dns || []) {
      const row=document.createElement('div');row.className='domain-record';
      const label=document.createElement('strong');label.textContent=record.type+' · '+record.name+(record.purpose==='ownership'?' · Verifikasi kepemilikan':'');row.append(label);
      const value=document.createElement('code');value.textContent=record.value;row.append(value);
      const copy=document.createElement('button');copy.className='btn btn-outline btn-sm';copy.textContent='Salin Nilai';copy.onclick=()=>copyToClipboard(record.value,copy);row.append(copy);root.append(row);
    }
    if (!domain.dns?.length) {const p=document.createElement('p');p.textContent='Vercel belum memberikan rekomendasi record DNS untuk domain ini. Periksa kembali setelah proses pemasangan selesai.';root.append(p);}
    if (domain.conflicts?.length) {const p=document.createElement('p');p.textContent='Ada record DNS yang bertentangan. Sesuaikan record hostname ini dengan rekomendasi di atas tanpa mengubah record domain lain.';root.append(p);}
    const check=document.createElement('button');check.className='btn btn-outline btn-sm';check.textContent='Periksa DNS & HTTPS';
    check.onclick=()=>saveAction(check,async()=>{const result=await api('/api/domains',{method:'POST',body:JSON.stringify({action:'check',domain:domain.name})});renderDomainDetails(result.domain);});root.append(check);
  }

  function updateQuickResultDomain() {
    const link = links.find(l => l.id === lastCreatedId);
    if (!link) return;
    const result = document.getElementById('quickResultUrl');
    result.href = shortUrl(link.slug); result.textContent = shortUrl(link.slug);
  }
  function updateSettingsState() {
    for (const id of ['btnSaveSettingsDomain', 'btnResetSettingsDomain', 'inputSettingsDomain', 'btnSaveAdminToken', 'btnLogoutAdmin']) document.getElementById(id).disabled = !cloudMode;
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
    const prefix = document.getElementById('domainPrefixDisplay');
    const addon = document.getElementById('modalDomainAddon');
    const topDomain = document.getElementById('topDomainText');
    const displayDomain = cloudMode ? customDomain : location.host;
    if (prefix) prefix.textContent = `${displayDomain}/`;
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
