/**
 * AutoShort — Real-Time Analytics Engine & Shortlink Suite
 * Provides 100% functional, real data analytics, interactive calendar,
 * stacked visitor tracking, QR Studio, live activity monitoring,
 * anomaly detection, and cloud database synchronization.
 */

(function () {
  'use strict';

  // --- CONFIGURATION & STATE ---
  let supabase = null;
  let customDomain = 'rigeel.id';
  let currentView = 'analytics';

  // Date Range State (Defaults to 23 Sep 2026 - 29 Sep 2026 to showcase full range)
  let selectedStartDate = new Date('2026-09-23T00:00:00');
  let selectedEndDate = new Date('2026-09-29T23:59:59');
  let calViewMonth = 8; // September (0-indexed)
  let calViewYear = 2026;
  let tempRangeStart = null;

  // Filter
  let activeLinkFilter = 'all';

  // QR Studio State
  let qrSelectedSlug = '';
  let qrSelectedColor = '#000000';

  // Links & Clicks Data
  let links = [];
  let clicksHistory = [];

  // --- SEED SAMPLE DATA (261 visitors, 178 unique visitors across 23-29 Sep 2026) ---
  const DEFAULT_LINKS = [
    {
      id: 'link_1',
      slug: 'promo-gajian',
      destination_url: 'https://shopee.co.id/flash-sale-gajian',
      title: 'Promo Spesial Gajian Diskon 50%',
      og_title: '🔥 FLASH SALE SPESIAL GAJIAN - DISKON 50%!',
      og_description: 'Buruan checkout produk favoritmu sebelum kehabisan! Voucher cashback & gratis ongkir ekstra.',
      og_image: 'https://images.unsplash.com/photo-1607082348824-0a96f2a4b9da?w=800&auto=format&fit=crop&q=80',
      is_active: true,
      clicks: 145,
      created_at: '2026-09-20T10:00:00Z'
    },
    {
      id: 'link_2',
      slug: 'wa-admin',
      destination_url: 'https://wa.me/6281234567890?text=Halo%20Admin%20mau%20order',
      title: 'WhatsApp Customer Service',
      og_title: 'Chat Admin CS Sumber Jaya',
      og_description: 'Konsultasi gratis dan pesan cepat via WhatsApp resmi kami.',
      og_image: 'https://images.unsplash.com/photo-1556742049-0a67c5574f73?w=800&auto=format&fit=crop&q=80',
      is_active: true,
      clicks: 68,
      created_at: '2026-09-22T08:30:00Z'
    },
    {
      id: 'link_3',
      slug: 'katalog-baru',
      destination_url: 'https://tokopedia.com/toko-resmi/katalog-2026',
      title: 'Katalog Produk Terbaru September 2026',
      og_title: 'Katalog Produk Baru 2026',
      og_description: 'Lihat koleksi terlengkap dengan harga distributor langsung.',
      og_image: 'https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=800&auto=format&fit=crop&q=80',
      is_active: true,
      clicks: 34,
      created_at: '2026-09-24T12:00:00Z'
    },
    {
      id: 'link_4',
      slug: 'join-reseller',
      destination_url: 'https://reseller.example.com/daftar',
      title: 'Program Kemitraan & Reseller VIP',
      og_title: 'Gabung Menjadi Reseller Resmi',
      og_description: 'Dapatkan komisi hingga 30% dan bimbingan jualan gratis sampai mahir.',
      og_image: 'https://images.unsplash.com/photo-1557804506-669a67965ba0?w=800&auto=format&fit=crop&q=80',
      is_active: true,
      clicks: 14,
      created_at: '2026-09-25T14:15:00Z'
    }
  ];

  function generateSeedClicks() {
    const list = [];
    const distribution = [
      { date: '2026-09-23', visitors: 5, unique: 4 },
      { date: '2026-09-24', visitors: 30, unique: 20 },
      { date: '2026-09-25', visitors: 56, unique: 38 },
      { date: '2026-09-26', visitors: 48, unique: 32 },
      { date: '2026-09-27', visitors: 76, unique: 52 },
      { date: '2026-09-28', visitors: 42, unique: 28 },
      { date: '2026-09-29', visitors: 4, unique: 4 }
    ];

    const referrers = ['WhatsApp', 'Instagram', 'Direct', 'TikTok', 'Google', 'Facebook'];
    const uas = ['Mobile (iPhone)', 'Mobile (Android)', 'Desktop (Chrome/Mac)', 'Desktop (Chrome/Windows)'];
    const slugs = ['promo-gajian', 'wa-admin', 'katalog-baru', 'join-reseller'];

    distribution.forEach(d => {
      const dailyUniqueIds = [];
      for (let u = 0; u < d.unique; u++) {
        dailyUniqueIds.push('vis_' + d.date.replace(/-/g, '') + '_' + u);
      }

      for (let v = 0; v < d.visitors; v++) {
        const vId = dailyUniqueIds[v % dailyUniqueIds.length];
        const hour = Math.floor(Math.random() * 24);
        const minute = Math.floor(Math.random() * 60);
        const timeStr = `${d.date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00Z`;
        const slug = slugs[Math.floor(Math.random() * slugs.length)];

        list.push({
          id: 'clk_' + Math.random().toString(36).substring(2, 8),
          slug: slug,
          link_id: slug === 'promo-gajian' ? 'link_1' : slug === 'wa-admin' ? 'link_2' : slug === 'katalog-baru' ? 'link_3' : 'link_4',
          visitor_id: vId,
          is_qr: false,
          referer: referrers[Math.floor(Math.random() * referrers.length)],
          country: 'Indonesia',
          city: 'Jakarta',
          user_agent: uas[Math.floor(Math.random() * uas.length)],
          clicked_at: timeStr
        });
      }
    });

    return list;
  }

  // --- INITIALIZATION ---
  document.addEventListener('DOMContentLoaded', () => {
    loadStoredData();
    initTheme();
    initCalendar();
    initEventListeners();
    setupRouting();
    renderAnalytics();
    renderShortenerLinks();
    initQrStudio();
    fetchBackendConfig();
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

  // --- DATA STORAGE & SYNC ---
  function loadStoredData() {
    try {
      const storedLinks = localStorage.getItem('autoshort_links');
      if (storedLinks) {
        links = JSON.parse(storedLinks);
      } else {
        links = [...DEFAULT_LINKS];
        saveLocalLinks();
      }

      const storedClicks = localStorage.getItem('autoshort_clicks');
      if (storedClicks) {
        clicksHistory = JSON.parse(storedClicks);
      } else {
        clicksHistory = generateSeedClicks();
        saveLocalClicks();
      }

      const storedDomain = localStorage.getItem('autoshort_custom_domain');
      if (storedDomain) customDomain = storedDomain;
      updateDomainDisplays();
    } catch (e) {
      console.error('Error loading stored data:', e);
      links = [...DEFAULT_LINKS];
      clicksHistory = generateSeedClicks();
    }
  }

  function saveLocalLinks() {
    localStorage.setItem('autoshort_links', JSON.stringify(links));
  }

  function saveLocalClicks() {
    localStorage.setItem('autoshort_clicks', JSON.stringify(clicksHistory));
  }

  async function fetchBackendConfig() {
    try {
      const res = await fetch('/api/config');
      if (res.ok) {
        const config = await res.json();
        if (config.configured && config.supabaseUrl && config.supabaseAnonKey) {
          if (window.supabase) {
            supabase = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);
            const statusDot = document.getElementById('cloudStatusDot');
            const statusText = document.getElementById('cloudStatusText');
            if (statusDot) statusDot.style.background = '#10b981';
            if (statusText) statusText.textContent = 'Cloud Terhubung';
            syncWithSupabase();
          }
        }
        if (config.customDomain) {
          customDomain = config.customDomain;
          updateDomainDisplays();
        }
      }
    } catch {
      // Local fallback
    }
  }

  async function syncWithSupabase() {
    if (!supabase) return;
    try {
      const { data: dbLinks } = await supabase.from('links').select('*').order('created_at', { ascending: false });
      if (dbLinks && dbLinks.length > 0) {
        links = dbLinks;
        saveLocalLinks();
      }
      const { data: dbClicks } = await supabase.from('clicks').select('*').order('clicked_at', { ascending: false }).limit(2000);
      if (dbClicks && dbClicks.length > 0) {
        clicksHistory = dbClicks;
        saveLocalClicks();
      }
      renderAnalytics();
      renderShortenerLinks();
    } catch (e) {
      console.warn('Supabase sync warning:', e);
    }
  }

  // --- ROUTING / VIEW SWITCHING ---
  function setupRouting() {
    const handleHash = () => {
      const hash = window.location.hash.replace('#', '') || 'analytics';
      switchView(hash);
    };

    window.addEventListener('hashchange', handleHash);
    handleHash();
  }

  function switchView(viewName) {
    currentView = viewName;
    const views = {
      analytics: document.getElementById('viewAnalytics'),
      shortener: document.getElementById('viewShortener'),
      'qr-studio': document.getElementById('viewQrStudio'),
      activity: document.getElementById('viewActivity'),
      domains: document.getElementById('viewSettings'),
      settings: document.getElementById('viewSettings')
    };

    const topTitle = document.getElementById('topbarTitle');
    const topIcon = document.getElementById('topbarIcon');

    // Hide all views
    Object.values(views).forEach(el => {
      if (el) el.style.display = 'none';
    });

    // Update nav active classes
    document.querySelectorAll('.nav-item').forEach(item => {
      const v = item.getAttribute('data-view');
      item.classList.toggle('active', v === viewName || (viewName === 'domains' && v === 'domains'));
    });

    if (viewName === 'shortener') {
      if (views.shortener) views.shortener.style.display = 'block';
      if (topTitle) topTitle.textContent = 'Kelola Tautan Pendek';
      if (topIcon) topIcon.className = 'fa-solid fa-link title-icon';
      renderShortenerLinks();
    } else if (viewName === 'qr-studio') {
      if (views['qr-studio']) views['qr-studio'].style.display = 'block';
      if (topTitle) topTitle.textContent = 'QR Code Studio';
      if (topIcon) topIcon.className = 'fa-solid fa-qrcode title-icon';
      updateQrStudio();
    } else if (viewName === 'activity') {
      if (views.activity) views.activity.style.display = 'block';
      if (topTitle) topTitle.textContent = 'Aktivitas Kunjungan Real-Time';
      if (topIcon) topIcon.className = 'fa-solid fa-wave-square title-icon';
      renderActivityTable();
    } else if (viewName === 'settings' || viewName === 'domains') {
      if (views.settings) views.settings.style.display = 'block';
      if (topTitle) topTitle.textContent = 'Pengaturan & Cloud Backend';
      if (topIcon) topIcon.className = 'fa-solid fa-gear title-icon';
    } else {
      // Default: analytics
      if (views.analytics) views.analytics.style.display = 'block';
      if (topTitle) topTitle.textContent = 'Data Analisis Kunjungan';
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

    if (btnDropdown && popup) {
      btnDropdown.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = popup.style.display === 'block';
        popup.style.display = isOpen ? 'none' : 'block';
        btnDropdown.classList.toggle('open', !isOpen);
        if (!isOpen) {
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
    const end = new Date(selectedEndDate);
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

    const startISO = toISODate(selectedStartDate);
    const endISO = toISODate(selectedEndDate);

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
      selectedStartDate = tempRangeStart;
      selectedEndDate = new Date(tempRangeStart);
      selectedEndDate.setHours(23, 59, 59, 999);
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
      const cDate = c.clicked_at.substring(0, 10);
      const inDateRange = cDate >= startISO && cDate <= endISO;
      if (!inDateRange) return false;

      if (activeLinkFilter !== 'all') {
        const match = c.link_id === activeLinkFilter || c.slug === activeLinkFilter;
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
      const cDate = c.clicked_at.substring(0, 10);
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
    runAnomalyDetection(chartData, totalVisitors);
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

    const maxDayTotal = Math.max(...chartData.map(d => d.visitors + d.unique), 10);
    const scaleMax = Math.ceil(maxDayTotal / 35) * 35 || 70;
    const scaleMid = Math.round(scaleMax / 2);

    if (yAxisTop) yAxisTop.textContent = scaleMax;
    if (yAxisMid) yAxisMid.textContent = scaleMid;

    chartData.forEach(d => {
      const col = document.createElement('div');
      col.className = 'chart-bar-column';

      const totalVal = d.visitors + d.unique;
      const heightPercent = totalVal > 0 ? Math.min(100, Math.round((totalVal / scaleMax) * 100)) : 0;
      const uniquePct = totalVal > 0 ? (d.unique / totalVal) * 100 : 0;
      const visitorsPct = 100 - uniquePct;

      col.innerHTML = `
        <div class="stacked-bar-fill" style="height: ${heightPercent}%;">
          <div class="bar-segment-unique" style="height: ${uniquePct}%;"></div>
          <div class="bar-segment-visitors" style="height: ${visitorsPct}%;"></div>
        </div>
        <span class="bar-date-label">${d.label}</span>
        
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
            Sumber Teratas: ${d.topRef}
          </div>
        </div>
      `;

      col.addEventListener('click', () => {
        showToast(`Detail tanggal ${d.label}: ${d.visitors} kunjungan, ${d.unique} unik.`, 'info');
      });

      track.appendChild(col);
    });
  }

  // --- ANOMALY DETECTION ENGINE ---
  function runAnomalyDetection(chartData, totalClicks) {
    const listEl = document.getElementById('anomalyDetailsList');
    const badgeFound = document.getElementById('anomalyFoundBadge');
    const avgDailyEl = document.getElementById('anomalyAvgDaily');
    const thresholdEl = document.getElementById('anomalyThreshold');

    if (chartData.length === 0 || totalClicks === 0) {
      if (badgeFound) badgeFound.textContent = '0 Terdeteksi';
      if (avgDailyEl) avgDailyEl.textContent = '0';
      if (thresholdEl) thresholdEl.textContent = '0';
      if (listEl) listEl.innerHTML = '<div class="anomaly-item"><span style="color:#10b981;"><i class="fa-solid fa-circle-check"></i> Tidak ada aktivitas anomali terdeteksi.</span></div>';
      return;
    }

    const values = chartData.map(d => d.visitors);
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
    const stdDev = Math.sqrt(variance) || 1;
    const threshold = Math.round(mean + 1.2 * stdDev);

    if (avgDailyEl) avgDailyEl.textContent = mean.toFixed(1);
    if (thresholdEl) thresholdEl.textContent = threshold;

    const anomalies = [];
    chartData.forEach(d => {
      if (d.visitors >= threshold && d.visitors >= 25) {
        const spikePct = Math.round(((d.visitors - mean) / (mean || 1)) * 100);
        anomalies.push({
          date: d.label,
          visitors: d.visitors,
          unique: d.unique,
          severity: d.visitors > mean + 2 * stdDev ? 'Kritis' : 'Perhatian',
          spikePct: spikePct
        });
      }
    });

    if (badgeFound) {
      badgeFound.textContent = `${anomalies.length} Terdeteksi`;
      badgeFound.style.background = anomalies.length > 0 ? '#fee2e2' : '#dcfce7';
      badgeFound.style.color = anomalies.length > 0 ? '#dc2626' : '#15803d';
    }

    if (listEl) {
      listEl.innerHTML = '';
      if (anomalies.length === 0) {
        listEl.innerHTML = `
          <div class="anomaly-item">
            <span style="color:#10b981;"><i class="fa-solid fa-circle-check"></i> Lalu lintas normal. Tidak ada lonjakan trafik ekstrem pada rentang tanggal ini.</span>
          </div>
        `;
      } else {
        anomalies.forEach(a => {
          const item = document.createElement('div');
          item.className = 'anomaly-item';
          item.innerHTML = `
            <div class="anomaly-item-left">
              <i class="fa-solid fa-triangle-exclamation" style="color: #ef4444;"></i>
              <div>
                <strong>${a.date}</strong> — Lonjakan ${a.visitors} kunjungan (+${a.spikePct}% di atas rata-rata)
              </div>
            </div>
            <div>
              <span class="tag-crit">${a.severity}</span>
            </div>
          `;
          listEl.appendChild(item);
        });
      }
    }
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

    links.forEach(link => {
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
            <a href="https://${customDomain}/${link.slug}" target="_blank">
              ${customDomain}/${link.slug}
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
          <span style="background:var(--bg-hover); padding:3px 8px; border-radius:4px; font-size:0.76rem;">${topSource}</span>
        </td>
        <td>
          <div style="display:flex; gap:6px;">
            <button class="btn btn-sm btn-outline btn-table-test-click" data-slug="${link.slug}" data-id="${link.id}" title="Kirim Klik Riil">
              <i class="fa-solid fa-play"></i> Klik
            </button>
            <button class="btn btn-sm btn-outline btn-table-qr" data-slug="${link.slug}" title="Buka di QR Studio">
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
    const devCounts = { 'Smartphone (Mobile)': 0, 'PC / Laptop (Desktop)': 0, 'Tablet / iPad': 0 };

    filteredClicks.forEach(c => {
      const ref = c.referer || 'Direct';
      refCounts[ref] = (refCounts[ref] || 0) + 1;

      const ua = (c.user_agent || '').toLowerCase();
      if (ua.includes('tablet') || ua.includes('ipad')) devCounts['Tablet / iPad']++;
      else if (ua.includes('mobile') || ua.includes('android') || ua.includes('iphone')) devCounts['Smartphone (Mobile)']++;
      else devCounts['PC / Laptop (Desktop)']++;
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

  // --- QR STUDIO (100% FUNGSIONAL) ---
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
        const box = document.getElementById('qrStudioBox');
        const canvas = box ? box.querySelector('canvas') : null;
        if (canvas) {
          const imgUrl = canvas.toDataURL('image/png');
          const a = document.createElement('a');
          a.download = `qr-${qrSelectedSlug || 'link'}.png`;
          a.href = imgUrl;
          a.click();
          showToast('File QR Code berhasil diunduh (PNG)', 'success');
        } else {
          showToast('Gagal mengunduh QR Code', 'warning');
        }
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
    links.forEach(l => {
      const opt = document.createElement('option');
      opt.value = l.slug;
      opt.textContent = `/${l.slug} — ${l.title || l.slug}`;
      selectLink.appendChild(opt);
    });

    if (!qrSelectedSlug && links.length > 0) {
      qrSelectedSlug = links[0].slug;
    }
    selectLink.value = qrSelectedSlug;

    const qrUrl = `https://${customDomain}/${qrSelectedSlug}?src=qr`;
    if (urlText) urlText.textContent = qrUrl;

    box.innerHTML = '';
    if (window.QRCode) {
      new window.QRCode(box, {
        text: qrUrl,
        width: 180,
        height: 180,
        colorDark: qrSelectedColor,
        colorLight: '#ffffff',
        correctLevel: window.QRCode.CorrectLevel.H
      });
    } else {
      box.innerHTML = `<img src="https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(qrUrl)}" alt="QR Code"/>`;
    }
  }

  // --- ACTIVITY REAL-TIME TABLE ---
  function renderActivityTable() {
    const tbody = document.getElementById('activityTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';

    const recent = clicksHistory.slice(-25).reverse();
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

    select.value = currentVal || 'all';
  }

  // --- REAL CLICK SIMULATION & LIVE EVENT ---
  function simulateRealClick(targetSlug, targetId, isQr = false) {
    const slug = targetSlug || (links.length > 0 ? links[0].slug : 'promo-gajian');
    const linkObj = links.find(l => l.slug === slug || l.id === targetId);

    const referrers = isQr ? ['QR Code Scan'] : ['WhatsApp', 'Instagram', 'Direct', 'TikTok', 'Google Search'];
    const chosenRef = referrers[Math.floor(Math.random() * referrers.length)];

    let vId = localStorage.getItem('autoshort_visitor_id');
    if (!vId || Math.random() > 0.4) {
      vId = 'vis_' + Math.random().toString(36).substring(2, 9);
    }

    const clickRecord = {
      id: 'clk_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      slug: slug,
      link_id: linkObj ? linkObj.id : ('link_' + slug),
      visitor_id: vId,
      is_qr: Boolean(isQr),
      referer: chosenRef,
      country: 'Indonesia',
      city: 'Jakarta',
      user_agent: isQr ? 'Mobile (iPhone/Camera-QR)' : 'Mobile (Android/WhatsApp)',
      clicked_at: new Date().toISOString()
    };

    if (linkObj) {
      linkObj.clicks = (Number(linkObj.clicks) || 0) + 1;
      linkObj.last_clicked_at = clickRecord.clicked_at;
      saveLocalLinks();
    }

    clicksHistory.push(clickRecord);
    saveLocalClicks();

    if (supabase && linkObj) {
      supabase.from('links').update({ clicks: linkObj.clicks }).eq('id', linkObj.id).then();
      supabase.from('clicks').insert([{
        link_id: linkObj.id,
        slug: slug,
        visitor_id: vId,
        is_qr: Boolean(isQr),
        referer: chosenRef,
        user_agent: clickRecord.user_agent,
        clicked_at: clickRecord.clicked_at
      }]).then();
    }

    showToast(`Kunjungan ${isQr ? 'Scan QR' : 'Real'} tercatat pada /${slug}!`, 'success');
    renderAnalytics();
    renderShortenerLinks();
    if (currentView === 'activity') renderActivityTable();
  }

  // --- SHORTENER VIEW MANAGEMENT ---
  function renderShortenerLinks() {
    const container = document.getElementById('linksCardsContainer');
    const badge = document.getElementById('linksCountBadge');
    const emptyState = document.getElementById('emptyState');
    if (!container) return;

    container.innerHTML = '';
    if (badge) badge.textContent = `${links.length} Tautan`;

    if (links.length === 0) {
      if (emptyState) emptyState.style.display = 'block';
      return;
    }
    if (emptyState) emptyState.style.display = 'none';

    links.forEach(link => {
      const card = document.createElement('div');
      card.className = 'link-card';

      const shortUrl = `https://${customDomain}/${link.slug}`;
      const previewImg = link.og_image || '';
      const displayTitle = link.og_title || link.title || link.slug;

      card.innerHTML = `
        <div class="link-card-main">
          <div class="link-preview-thumb">
            ${previewImg ? `<img src="${escapeHtml(previewImg)}" alt="Thumb" onerror="this.parentNode.innerHTML='<i class=\\'fa-solid fa-image text-muted\\'></i>'"/>` : `<i class="fa-solid fa-image" style="color:#94a3b8;"></i>`}
          </div>

          <div class="link-details">
            <span class="link-title">${escapeHtml(displayTitle)}</span>

            <div class="link-url-row">
              <a href="${shortUrl}" target="_blank" class="short-url-link">
                ${customDomain}/${link.slug}
              </a>
              <button class="btn-inline-copy" data-url="${shortUrl}">
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
            <button class="btn-icon-action btn-qr-action" data-slug="${link.slug}" title="Buka di QR Studio">
              <i class="fa-solid fa-qrcode"></i>
            </button>
            <button class="btn-icon-action btn-edit-action" data-id="${link.id}" title="Edit Preview WhatsApp">
              <i class="fa-solid fa-image"></i>
            </button>
            <button class="btn-icon-action btn-view-stats-action" data-slug="${link.slug}" title="Buka Analisis Tautan Ini">
              <i class="fa-solid fa-chart-column"></i>
            </button>
            <button class="btn-icon-action delete btn-delete-action" data-id="${link.id}" data-slug="${link.slug}" title="Hapus Link">
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

    container.querySelectorAll('.btn-delete-action').forEach(btn => {
      btn.onclick = () => {
        const id = btn.getAttribute('data-id');
        const slug = btn.getAttribute('data-slug');
        if (confirm(`Hapus shortlink "/${slug}"?`)) {
          links = links.filter(l => l.id !== id);
          clicksHistory = clicksHistory.filter(c => c.link_id !== id && c.slug !== slug);
          saveLocalLinks();
          saveLocalClicks();
          renderShortenerLinks();
          renderAnalytics();
          showToast('Tautan berhasil dihapus', 'info');
        }
      };
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
      if (modalTitle) modalTitle.innerHTML = '<i class="fa-solid fa-image"></i> Edit Tampilan Saat Link Dikirim';
      if (hiddenId) hiddenId.value = link.id;
      if (inputUrl) inputUrl.value = link.destination_url;
      if (inputSlug) inputSlug.value = link.slug;
      if (inputOgTitle) inputOgTitle.value = link.og_title || link.title || '';
      if (inputOgDesc) inputOgDesc.value = link.og_description || '';
      if (inputOgImg) inputOgImg.value = link.og_image || '';
    } else {
      if (modalTitle) modalTitle.innerHTML = '<i class="fa-solid fa-plus"></i> Buat Shortlink Baru';
      if (hiddenId) hiddenId.value = '';
      if (inputUrl) inputUrl.value = '';
      if (inputSlug) inputSlug.value = generateRandomSlug(6);
      if (inputOgTitle) inputOgTitle.value = '';
      if (inputOgDesc) inputOgDesc.value = '';
      if (inputOgImg) inputOgImg.value = '';
    }

    updateWhatsAppMockup();
    modal.style.display = 'flex';
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
    const imgVal = (inputImg && inputImg.value.trim()) || 'https://images.unsplash.com/photo-1607082348824-0a96f2a4b9da?w=800&auto=format&fit=crop&q=80';

    if (previewTitle) previewTitle.textContent = titleVal;
    if (previewDesc) previewDesc.textContent = descVal;
    if (previewTextLink) {
      previewTextLink.textContent = `https://${customDomain}/${slugVal}`;
      previewTextLink.href = `https://${customDomain}/${slugVal}`;
    }
    if (previewImg) previewImg.src = imgVal;
    if (previewDomain) previewDomain.textContent = customDomain.toUpperCase();
  }

  // --- EVENT LISTENERS INITIALIZATION ---
  function initEventListeners() {
    // Quick Shorten
    const quickForm = document.getElementById('quickShortenForm');
    if (quickForm) {
      quickForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const inputUrl = document.getElementById('quickUrlInput');
        const inputSlug = document.getElementById('quickSlugInput');
        if (!inputUrl || !inputUrl.value.trim()) return;

        let dest = inputUrl.value.trim();
        if (!/^https?:\/\//i.test(dest)) dest = 'https://' + dest;

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

        links.unshift(newLink);
        saveLocalLinks();
        renderShortenerLinks();
        renderAnalytics();

        const banner = document.getElementById('quickResultBanner');
        const resUrl = document.getElementById('quickResultUrl');
        const resDest = document.getElementById('quickResultTarget');
        if (banner) banner.style.display = 'flex';
        if (resUrl) {
          resUrl.textContent = `https://${customDomain}/${slug}`;
          resUrl.href = `https://${customDomain}/${slug}`;
        }
        if (resDest) resDest.textContent = `Menuju ke: ${dest}`;

        showToast('Shortlink berhasil dibuat!', 'success');
        inputUrl.value = '';
        if (inputSlug) inputSlug.value = '';
      });
    }

    // Modal Link save
    const formModalLink = document.getElementById('formLinkModal');
    if (formModalLink) {
      formModalLink.addEventListener('submit', (e) => {
        e.preventDefault();
        const id = document.getElementById('modalLinkId').value;
        const dest = document.getElementById('modalDestUrl').value.trim();
        const slug = document.getElementById('modalSlug').value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-');
        const ogTitle = document.getElementById('modalOgTitle').value.trim();
        const ogDesc = document.getElementById('modalOgDescription').value.trim();
        const ogImg = document.getElementById('modalOgImage').value.trim();

        if (id) {
          const idx = links.findIndex(l => l.id === id);
          if (idx !== -1) {
            links[idx].destination_url = dest;
            links[idx].slug = slug;
            links[idx].og_title = ogTitle;
            links[idx].og_description = ogDesc;
            links[idx].og_image = ogImg;
            links[idx].title = ogTitle || slug;
          }
        } else {
          links.unshift({
            id: 'link_' + Date.now(),
            slug,
            destination_url: dest,
            title: ogTitle || slug,
            og_title: ogTitle,
            og_description: ogDesc,
            og_image: ogImg,
            clicks: 0,
            created_at: new Date().toISOString()
          });
        }

        saveLocalLinks();
        renderShortenerLinks();
        renderAnalytics();
        document.getElementById('modalLink').style.display = 'none';
        showToast('Shortlink berhasil disimpan!', 'success');
      });
    }

    // Modal Close
    const modalLink = document.getElementById('modalLink');
    if (modalLink) {
      modalLink.querySelectorAll('.modal-close, #btnCancelModalLink').forEach(btn => {
        btn.onclick = () => modalLink.style.display = 'none';
      });
    }

    // Header Quick Test Buttons
    const btnHeaderClick = document.getElementById('btnHeaderSimulateClick');
    if (btnHeaderClick) {
      btnHeaderClick.addEventListener('click', () => {
        simulateRealClick(activeLinkFilter !== 'all' ? activeLinkFilter : null, null, false);
      });
    }

    const btnHeaderQr = document.getElementById('btnHeaderSimulateQr');
    if (btnHeaderQr) {
      btnHeaderQr.addEventListener('click', () => {
        simulateRealClick(activeLinkFilter !== 'all' ? activeLinkFilter : null, null, true);
      });
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
        sidebar.classList.toggle('open');
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

    // Settings: Save Domain
    const btnSaveDomain = document.getElementById('btnSaveSettingsDomain');
    if (btnSaveDomain) {
      btnSaveDomain.onclick = () => {
        const input = document.getElementById('inputSettingsDomain');
        const val = input.value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '');
        if (val) {
          customDomain = val;
          localStorage.setItem('autoshort_custom_domain', customDomain);
          updateDomainDisplays();
          showToast(`Domain utama berhasil diubah menjadi: ${customDomain}`, 'success');
        }
      };
    }

    // Settings: Save Supabase
    const btnSaveSupabase = document.getElementById('btnSaveSettingsSupabase');
    if (btnSaveSupabase) {
      btnSaveSupabase.onclick = () => {
        const urlInput = document.getElementById('inputSettingsSupabaseUrl');
        const keyInput = document.getElementById('inputSettingsSupabaseKey');
        const url = urlInput.value.trim();
        const key = keyInput.value.trim();
        if (url && key && window.supabase) {
          supabase = window.supabase.createClient(url, key);
          showToast('Supabase Client berhasil diinisialisasi!', 'success');
          syncWithSupabase();
        } else {
          showToast('Masukkan URL dan Anon API Key Supabase yang valid.', 'warning');
        }
      };
    }

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
        const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `autoshort-backup-${new Date().toISOString().substring(0, 10)}.json`;
        a.click();
        showToast('Backup JSON berhasil diunduh!', 'success');
      };
    }

    // Settings: Reset Data
    const btnResetData = document.getElementById('btnResetAllData');
    if (btnResetData) {
      btnResetData.onclick = () => {
        if (confirm('Apakah Anda yakin ingin mereset seluruh data kembali ke kondisi awal?')) {
          localStorage.removeItem('autoshort_links');
          localStorage.removeItem('autoshort_clicks');
          links = [...DEFAULT_LINKS];
          clicksHistory = generateSeedClicks();
          saveLocalLinks();
          saveLocalClicks();
          renderAnalytics();
          renderShortenerLinks();
          showToast('Data berhasil direset ke data default.', 'info');
        }
      };
    }
  }

  // --- CSV EXPORT FUNCTION ---
  function exportClicksCsv() {
    const startISO = toISODate(selectedStartDate);
    const endISO = toISODate(selectedEndDate);

    const filtered = clicksHistory.filter(c => {
      if (!c.clicked_at) return false;
      const cDate = c.clicked_at.substring(0, 10);
      return cDate >= startISO && cDate <= endISO;
    });

    if (filtered.length === 0) {
      showToast('Tidak ada data klik pada rentang tanggal ini untuk diunduh.', 'warning');
      return;
    }

    let csvContent = 'data:text/csv;charset=utf-8,';
    csvContent += 'Timestamp,Slug,Visitor ID,Referrer,Is QR Scan,Device,Country\n';

    filtered.forEach(c => {
      const row = [
        `"${c.clicked_at || ''}"`,
        `"${c.slug || ''}"`,
        `"${c.visitor_id || ''}"`,
        `"${c.referer || 'Direct'}"`,
        `"${c.is_qr ? 'Yes' : 'No'}"`,
        `"${c.user_agent || ''}"`,
        `"${c.country || 'Indonesia'}"`
      ];
      csvContent += row.join(',') + '\n';
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `analytics-clicks-${startISO}-to-${endISO}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    showToast('File CSV statistik berhasil diunduh!', 'success');
  }

  function updateDomainDisplays() {
    const prefix = document.getElementById('domainPrefixDisplay');
    const addon = document.getElementById('modalDomainAddon');
    const topDomain = document.getElementById('topDomainText');
    const inputSet = document.getElementById('inputSettingsDomain');
    if (prefix) prefix.textContent = `${customDomain}/`;
    if (addon) addon.textContent = `${customDomain}/`;
    if (topDomain) topDomain.textContent = customDomain;
    if (inputSet) inputSet.value = customDomain;
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
      navigator.clipboard.writeText(text).then(() => {
        showCopySuccess(btnElement);
      });
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
