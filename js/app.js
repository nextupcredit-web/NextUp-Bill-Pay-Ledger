/* ============================================================
   NextUp Bill Pay Ledger — Dashboard Controller
   Renders every tab from NextUpStore data and wires up live
   editing: numeric fields recompute totals as you type, selects
   and adds/deletes do a full refresh of the tab they touched.
   ============================================================ */

const NextUpApp = (() => {
  let DATA = null;
  let USER = null;
  let activeTab = 'overview';
  let openDebtIds = null;
  let pnlPeriod = 'month';
  let pnlCustomStart = null;
  let pnlCustomEnd = null;
  let incomePayOpenIds = new Set();
  let progressCharts = { score: null, trend: null };

  const WEEKDAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const WD_SHORT = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const NTH_LABEL = { 1: '1st', 2: '2nd', 3: '3rd', 4: '4th' };
  const ICON_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.5 2.5L16 9.5"/></svg>';
  const ICON_CARD = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="5.5" width="19" height="13" rx="2.2"/><path d="M2.5 9.8h19"/></svg>';

  function fmt(n) { return NextUpStore.fmtMoney(n); }
  function planLabel(user) {
    if (user.plan === 'demo') return 'Demo account';
    if (user.status === 'trialing' && user.trialEndsAt) {
      const daysLeft = Math.max(0, Math.ceil((new Date(user.trialEndsAt) - new Date()) / 86400000));
      return `Free trial · ${daysLeft} day${daysLeft === 1 ? '' : 's'} left`;
    }
    return 'NextUp Pro · $9/mo';
  }
  function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str == null ? '' : String(str);
    return d.innerHTML;
  }

  function persist() { NextUpStore.save(USER.id, DATA).catch(err => console.error('Save failed', err)); }

  function getArray(kind) {
    if (kind === 'business.income') return DATA.business.income;
    if (kind === 'business.expenses') return DATA.business.expenses;
    if (kind === 'business.transactions') return DATA.business.transactions;
    return DATA[kind];
  }
  function findItem(kind, id) { return (getArray(kind) || []).find(x => x.id === id); }

  // ---------- init ----------
  async function init(user) {
    USER = user;
    DATA = await NextUpStore.ensureData(user.id, user.isOwner);
    if (NextUpStore.captureSnapshotIfNeeded(DATA)) persist();

    document.querySelectorAll('.user-name-display').forEach(el => el.textContent = user.name || user.email);
    document.querySelectorAll('.user-plan-display').forEach(el => el.textContent = planLabel(user));
    document.querySelectorAll('.avatar-display').forEach(el => el.textContent = (user.name || user.email || '?').trim().charAt(0).toUpperCase());

    document.querySelectorAll('.side-link[data-tab]').forEach(link => {
      link.addEventListener('click', (e) => { e.preventDefault(); switchTab(link.dataset.tab); closeSidebar(); });
    });
    document.querySelectorAll('.logout-trigger').forEach(btn => btn.addEventListener('click', (e) => {
      e.preventDefault();
      NextUpAuth.logOut();
      window.location.href = 'index.html';
    }));

    const sidebarToggle = document.getElementById('sidebarToggle');
    const sidebarBackdrop = document.getElementById('sidebarBackdrop');
    const sidebarEl = document.querySelector('.sidebar');
    if (sidebarToggle && sidebarEl) {
      sidebarToggle.addEventListener('click', () => {
        const open = sidebarEl.classList.toggle('open');
        sidebarToggle.setAttribute('aria-expanded', String(open));
        if (sidebarBackdrop) sidebarBackdrop.classList.toggle('show', open);
      });
      if (sidebarBackdrop) sidebarBackdrop.addEventListener('click', closeSidebar);
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSidebar(); });
    }

    const billingBtn = document.getElementById('billingTrigger');
    if (billingBtn) {
      billingBtn.addEventListener('click', (e) => {
        e.preventDefault();
        switchTab('settings');
        closeSidebar();
      });
    }

    bindGlobalDelegation();
    NextUpCalendar.mount(document.getElementById('calRoot'), () => DATA);
    document.getElementById('dayModalClose').addEventListener('click', closeDayModal);
    document.getElementById('dayModalOverlay').addEventListener('click', (e) => { if (e.target.id === 'dayModalOverlay') closeDayModal(); });

    switchTab('overview');

    if (window.NEXTUP_DEMO_MODE) initDemoMode();
  }

  // ================================================================
  // DEMO MODE: banner + guided tour
  // ================================================================
  const TOUR_STEPS = [
    { tab: 'overview', text: 'This is your whole financial picture in one place — income, bills, debt, and margin, updated live as you type.' },
    { tab: 'income', text: 'Log every paycheck (W-2 or self-employed). Hourly, salary, or YTD-average entry all auto-calculate an estimated net pay.' },
    { tab: 'bills', text: 'Every recurring bill lives here — add one, set its schedule, and totals update instantly.' },
    { tab: 'debts', text: 'Your debt snowball, smallest balance first. Tap a card to expand it and see payoff estimates and progress.' },
    { tab: 'business', text: 'Keep a side business or freelance income totally separate, with its own profit & loss and PDF export.' },
    { tab: 'savings', text: 'Track savings, investing, and retirement contributions — mark each as a real expense or just a transfer.' },
    { tab: 'calendar', text: 'Every bill, debt payment, and payday lands on the calendar so you can see what\'s due and when.' },
    { tab: 'progress', text: 'Log your credit score from all three bureaus and watch your financial trends over time.' },
    { tab: 'all', text: 'One combined, searchable list of absolutely everything in your ledger.' },
    { tab: 'settings', text: 'Account and billing settings live here.' },
    { tab: 'feedback', text: 'Loved something, hated something, found a bug? Tell us right here — it comes straight to us.' }
  ];
  let tourIndex = 0;

  function initDemoMode() {
    const banner = document.createElement('div');
    banner.className = 'demo-banner';
    banner.innerHTML = `
      <span class="tag">Demo</span>
      <span>You're exploring a live sandbox — poke around, nothing here is real and nothing you do affects anyone else.</span>
      <button class="btn btn-secondary btn-sm" id="demoTourBtn">Take the tour</button>
      <a class="btn btn-primary btn-sm" href="signup.html">Get started free &rarr;</a>
    `;
    document.body.insertBefore(banner, document.body.firstChild);
    document.getElementById('demoTourBtn').addEventListener('click', () => startTour());

    if (!sessionStorage.getItem('nextupDemoTourDone')) {
      setTimeout(() => startTour(), 500);
    }
  }

  function startTour() {
    tourIndex = 0;
    document.body.classList.add('tour-active');
    const sidebarEl = document.querySelector('.sidebar');
    if (sidebarEl) sidebarEl.classList.add('open');
    showTourStep();
  }

  function endTour() {
    document.body.classList.remove('tour-active');
    document.querySelectorAll('.tour-highlight').forEach(el => el.classList.remove('tour-highlight'));
    const tip = document.getElementById('tourTooltip');
    if (tip) tip.remove();
    const sidebarEl = document.querySelector('.sidebar');
    if (sidebarEl && window.innerWidth <= 640) closeSidebar();
    sessionStorage.setItem('nextupDemoTourDone', '1');
  }

  function showTourStep() {
    const step = TOUR_STEPS[tourIndex];
    if (!step) { endTour(); return; }
    switchTab(step.tab);
    document.querySelectorAll('.tour-highlight').forEach(el => el.classList.remove('tour-highlight'));
    const link = document.querySelector(`.sidebar .side-link[data-tab="${step.tab}"]`);
    if (link) link.classList.add('tour-highlight');
    renderTourTooltip(link, step);
  }

  function renderTourTooltip(anchorEl, step) {
    let tip = document.getElementById('tourTooltip');
    if (!tip) {
      tip = document.createElement('div');
      tip.id = 'tourTooltip';
      tip.className = 'tour-tooltip';
      document.body.appendChild(tip);
    }
    const isLast = tourIndex === TOUR_STEPS.length - 1;
    const vw = window.innerWidth, vh = window.innerHeight;
    let top = 90, left = 16;
    if (anchorEl) {
      const rect = anchorEl.getBoundingClientRect();
      top = Math.min(rect.bottom + 10, vh - 190);
      left = Math.min(Math.max(rect.left, 12), vw - 288);
      if (top < 10) top = 10;
    }
    tip.style.top = top + 'px';
    tip.style.left = left + 'px';
    tip.innerHTML = `
      <div class="tour-step-count">Step ${tourIndex + 1} of ${TOUR_STEPS.length}</div>
      <div class="tour-text">${escapeHtml(step.text)}</div>
      <div class="tour-actions">
        <button class="btn btn-ghost btn-sm" id="tourSkip">Skip tour</button>
        <div style="display:flex;gap:8px;">
          ${tourIndex > 0 ? '<button class="btn btn-secondary btn-sm" id="tourBack">Back</button>' : ''}
          <button class="btn btn-primary btn-sm" id="tourNext">${isLast ? 'Finish' : 'Next'}</button>
        </div>
      </div>
    `;
    document.getElementById('tourSkip').addEventListener('click', endTour);
    document.getElementById('tourNext').addEventListener('click', () => { tourIndex++; showTourStep(); });
    const back = document.getElementById('tourBack');
    if (back) back.addEventListener('click', () => { tourIndex--; showTourStep(); });
  }

  function closeDayModal() { document.getElementById('dayModalOverlay').classList.remove('show'); }

  function closeSidebar() {
    const sidebarEl = document.querySelector('.sidebar');
    const sidebarToggle = document.getElementById('sidebarToggle');
    const sidebarBackdrop = document.getElementById('sidebarBackdrop');
    if (sidebarEl) sidebarEl.classList.remove('open');
    if (sidebarToggle) sidebarToggle.setAttribute('aria-expanded', 'false');
    if (sidebarBackdrop) sidebarBackdrop.classList.remove('show');
  }

  function switchTab(tab) {
    activeTab = tab;
    document.querySelectorAll('.side-link[data-tab]').forEach(l => l.classList.toggle('active', l.dataset.tab === tab));
    document.querySelectorAll('.tabpage').forEach(p => p.classList.toggle('active', p.id === 'tab-' + tab));
    const titles = {
      overview: ['Overview', 'Your whole financial picture, updated in real time.'],
      income: ['Income', 'Every paycheck and payday, personal and self-employed.'],
      bills: ['Bills', 'Fixed costs and recurring personal bills.'],
      debts: ['Debt Snowball', 'Smallest to largest — track payoff as you pay it down.'],
      business: ['Business', 'NextUp Enterprise income and expenses, kept separate.'],
      savings: ['Savings', 'Where your money goes after it\'s earned — savings, investing, and retirement.'],
      calendar: ['Calendar', 'Every bill, debt, and payday on the dates they land.'],
      progress: ['Progress', 'Credit score and financial trends, tracked over time.'],
      all: ['All Items', 'One list of everything across your whole ledger.'],
      settings: ['Settings', 'Your account, billing, and app preferences.'],
      feedback: ['Feedback', 'Tell us what you think — this goes straight to the team.']
    };
    const [h, sub] = titles[tab] || ['', ''];
    document.getElementById('mainTitle').textContent = h;
    document.getElementById('mainSub').textContent = sub;

    if (tab === 'overview') renderOverview();
    else if (tab === 'income') renderIncome();
    else if (tab === 'bills') renderBills();
    else if (tab === 'debts') renderDebts();
    else if (tab === 'business') renderBusiness();
    else if (tab === 'savings') renderSavings();
    else if (tab === 'calendar') NextUpCalendar.refresh();
    else if (tab === 'progress') renderProgress();
    else if (tab === 'all') renderAllItems();
    else if (tab === 'settings') renderSettings();
    else if (tab === 'feedback') renderFeedback();
  }

  function toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast._h);
    toast._h = setTimeout(() => t.classList.remove('show'), 2200);
  }

  // ---------- schedule helpers ----------
  function scheduleSummary(item) {
    switch (item.frequency) {
      case 'weekly': return `Weekly · ${WD_SHORT[item.weekday] ?? '—'}`;
      case 'biweekly': return `Biweekly · from ${item.anchorDate ? new Date(item.anchorDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}`;
      case 'monthly': return `Monthly · day ${item.dueDay || '—'}`;
      case 'monthly-nth-weekday': return `Monthly · ${NTH_LABEL[item.nth] || item.nth + 'th'} ${WD_SHORT[item.weekday]}`;
      case 'onetime': return `One-time · ${item.date ? new Date(item.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}`;
      default: return item.frequency || '—';
    }
  }

  function scheduleFieldsHTML(kind, id, item, freqOptions) {
    const freq = item.frequency;
    let html = `<select class="cell-input" data-kind="${kind}" data-id="${id}" data-field="frequency" data-refresh="tab">`;
    freqOptions.forEach(f => { html += `<option value="${f.v}" ${freq === f.v ? 'selected' : ''}>${f.l}</option>`; });
    html += `</select> `;

    if (freq === 'weekly') {
      html += `<select class="cell-input" data-kind="${kind}" data-id="${id}" data-field="weekday" data-parse="int" data-refresh="tab">
        ${WD_SHORT.map((w, i) => `<option value="${i}" ${item.weekday === i ? 'selected' : ''}>${w}</option>`).join('')}
      </select>`;
    } else if (freq === 'monthly') {
      html += `<input class="cell-input" style="width:56px" type="number" min="1" max="31" data-kind="${kind}" data-id="${id}" data-field="dueDay" data-parse="int" value="${item.dueDay ?? ''}" placeholder="day">`;
    } else if (freq === 'monthly-nth-weekday') {
      html += `<select class="cell-input" data-kind="${kind}" data-id="${id}" data-field="nth" data-parse="int" data-refresh="tab">
        ${[1,2,3,4].map(n => `<option value="${n}" ${item.nth === n ? 'selected' : ''}>${NTH_LABEL[n]}</option>`).join('')}
      </select>
      <select class="cell-input" data-kind="${kind}" data-id="${id}" data-field="weekday" data-parse="int" data-refresh="tab">
        ${WD_SHORT.map((w, i) => `<option value="${i}" ${item.weekday === i ? 'selected' : ''}>${w}</option>`).join('')}
      </select>`;
    } else if (freq === 'biweekly') {
      html += `<input class="cell-input" type="date" data-kind="${kind}" data-id="${id}" data-field="anchorDate" value="${item.anchorDate || ''}">`;
    } else if (freq === 'onetime') {
      html += `<input class="cell-input" type="date" data-kind="${kind}" data-id="${id}" data-field="date" value="${item.date || ''}">`;
    }
    return html;
  }

  // ================================================================
  // OVERVIEW
  // ================================================================
  function renderOverview() {
    const s = NextUpStore.computeSummary(DATA);
    const root = document.getElementById('tab-overview');

    const useAmount = DATA.settings.customTransferAmount != null && DATA.settings.customTransferAmount !== ''
      ? Number(DATA.settings.customTransferAmount) : null;
    const freq = DATA.settings.customTransferFrequency || 'weekly';

    root.innerHTML = `
      <div class="stat-grid">
        <div class="stat-card accent"><div class="lbl">Total Monthly Income</div><div class="val">${fmt(s.totalIncomeMonthly)}</div><div class="note">Personal + self-employed, combined</div></div>
        <div class="stat-card"><div class="lbl">Total Monthly Expenses</div><div class="val">${fmt(s.totalExpensesMonthly)}</div><div class="note">Bills + debt payments + business</div></div>
        <div class="stat-card ${s.monthlyMargin >= 0 ? 'positive' : 'negative'}"><div class="lbl">Monthly Margin</div><div class="val">${fmt(s.monthlyMargin)}</div><div class="note">What's left over each month</div></div>
        <div class="stat-card ${s.weeklyMargin >= 0 ? 'positive' : 'negative'}"><div class="lbl">Weekly Margin</div><div class="val">${fmt(s.weeklyMargin)}</div><div class="note">What's left over each week</div></div>
        <div class="stat-card">
          <div class="lbl">Bill Pay Account transfer</div>
          <div class="val" id="ovBillPayStat">${fmt(useAmount != null ? useAmount : (freq==='weekly'?s.recommendedWeeklyTransfer:freq==='biweekly'?s.recommendedBiweeklyTransfer:s.recommendedMonthlyTransfer))}</div>
          <div class="note" id="ovBillPayStatFreq">Move this ${freq} into your Bill Pay Account</div>
        </div>
      </div>

      <div class="panel-grid">
        <div>
          <div class="card">
            <div class="card-head"><h3>Bill Pay Account</h3><span class="sub">Auto-calculated — override it anytime</span></div>
            <p style="font-size:12.5px;color:var(--text-muted);margin:-6px 0 12px;">
              Set up autopay from your main account into a separate account used only to pay bills. This is what to move, and how often.
            </p>
            <div class="highlight-box">
              <div class="lbl">Recommended weekly transfer</div>
              <div class="big" id="ovRecWeekly">${fmt(s.recommendedWeeklyTransfer)}</div>
              <div style="font-size:12.5px;color:var(--text-muted);margin-top:6px;">
                Monthly equivalent <strong id="ovRecMonthly">${fmt(s.recommendedMonthlyTransfer)}</strong> ·
                Biweekly <strong id="ovRecBiweekly">${fmt(s.recommendedBiweeklyTransfer)}</strong>
              </div>
            </div>
            <div class="field-row" style="margin-top:14px;">
              <div class="field">
                <label>Buffer (per week)</label>
                <input class="field-input" type="number" step="0.01" min="0" id="ovBuffer" value="${DATA.settings.weeklyBuffer}">
              </div>
              <div class="field">
                <label>Your transfer amount (override)</label>
                <input class="field-input" type="number" step="0.01" min="0" id="ovCustomAmount" placeholder="Use recommended" value="${useAmount != null ? useAmount : ''}">
              </div>
            </div>
            <div class="field" style="margin-top:12px;">
              <label>Frequency for your Bill Pay Account transfer</label>
              <div class="freq-toggle">
                <button data-freq="weekly" class="${freq==='weekly'?'active':''}">Weekly</button>
                <button data-freq="biweekly" class="${freq==='biweekly'?'active':''}">Biweekly</button>
                <button data-freq="monthly" class="${freq==='monthly'?'active':''}">Monthly</button>
              </div>
            </div>
            <div style="margin-top:14px;padding-top:14px;border-top:1px dashed var(--border);font-size:13px;color:var(--text-muted);display:flex;justify-content:space-between;">
              <span>What you'll actually move</span>
              <strong id="ovYourTransfer" style="color:var(--chase-blue-dark);font-size:16px;">
                ${fmt(useAmount != null ? useAmount : (freq==='weekly'?s.recommendedWeeklyTransfer:freq==='biweekly'?s.recommendedBiweeklyTransfer:s.recommendedMonthlyTransfer))} / ${freq}
              </strong>
            </div>
          </div>

          <div class="card">
            <div class="card-head"><h3>Breakdown</h3></div>
            <div class="table-wrap"><table class="table table-compact">
              <tbody>
                <tr><td><span class="pill pill-bill">Bills</span></td><td style="text-align:right;">${fmt(s.billsMonthly)}/mo</td></tr>
                <tr><td><span class="pill pill-debt">Debt payments</span></td><td style="text-align:right;">${fmt(s.debtsMonthly)}/mo</td></tr>
                <tr><td><span class="pill pill-business">Business expenses</span></td><td style="text-align:right;">${fmt(s.businessExpMonthly)}/mo</td></tr>
                <tr><td><span class="pill pill-income">Business income</span></td><td style="text-align:right;">${fmt(s.businessIncomeMonthly)}/mo</td></tr>
                <tr><td>Business net position</td><td style="text-align:right;font-weight:700;color:${s.businessNet>=0?'var(--income-green)':'var(--debt-red)'}">${fmt(s.businessNet)}/mo</td></tr>
              </tbody>
            </table></div>
          </div>

          <div class="card">
            <div class="card-head"><h3>Your data</h3><span class="sub">Synced securely to your account</span></div>
            <div style="display:flex;gap:10px;flex-wrap:wrap;">
              <button class="btn btn-secondary btn-sm" id="btnExport">Export JSON</button>
              <button class="btn btn-secondary btn-sm" id="btnImport">Import JSON</button>
              <input type="file" id="fileImport" accept="application/json" style="display:none;">
              <button class="btn btn-secondary btn-sm" id="btnResetSeed">Reset to sample data</button>
              <button class="btn btn-danger btn-sm" id="btnClearAll">${USER.plan === 'demo' ? 'Reset demo' : 'Clear all data'}</button>
            </div>
          </div>
        </div>

        <div>
          <div class="card">
            <div class="card-head"><h3>Next 7 days</h3></div>
            <div id="ovUpcoming"></div>
          </div>
          <div class="card">
            <div class="card-head"><h3>Debt Snowball</h3><span class="sub">Smallest → largest</span></div>
            <div id="ovDebtSummary"></div>
          </div>
        </div>
      </div>
    `;

    renderUpcoming();
    renderDebtSummaryMini();

    document.getElementById('ovBuffer').addEventListener('input', (e) => {
      DATA.settings.weeklyBuffer = parseFloat(e.target.value) || 0;
      persist();
      recomputeTransferBox();
    });
    document.getElementById('ovCustomAmount').addEventListener('input', (e) => {
      DATA.settings.customTransferAmount = e.target.value === '' ? null : parseFloat(e.target.value);
      persist();
      recomputeTransferBox();
    });
    root.querySelectorAll('.freq-toggle button').forEach(b => {
      b.addEventListener('click', () => {
        DATA.settings.customTransferFrequency = b.dataset.freq;
        persist();
        root.querySelectorAll('.freq-toggle button').forEach(x => x.classList.toggle('active', x === b));
        recomputeTransferBox();
      });
    });

    document.getElementById('btnExport').addEventListener('click', exportData);
    document.getElementById('btnImport').addEventListener('click', () => document.getElementById('fileImport').click());
    document.getElementById('fileImport').addEventListener('change', importData);
    document.getElementById('btnResetSeed').addEventListener('click', async () => {
      if (!confirm('Reset all data back to the sample ledger? This replaces everything currently entered.')) return;
      DATA = await NextUpStore.resetToSeed(USER.id, USER.isOwner);
      switchTab('overview'); toast('Reset to sample data');
    });
    document.getElementById('btnClearAll').addEventListener('click', async () => {
      if (USER.plan === 'demo') {
        // Demo/presentation accounts reseed to a clean sample ledger instead of
        // going blank, so this account always looks presentation-ready.
        if (!confirm('Reset this demo account back to a clean sample ledger?')) return;
        DATA = await NextUpStore.resetToSeed(USER.id, false);
        switchTab('overview'); toast('Demo reset');
        return;
      }
      if (!confirm('Delete everything and start from a blank ledger?')) return;
      DATA = await NextUpStore.wipe(USER.id);
      switchTab('overview'); toast('Cleared');
    });
  }

  function recomputeTransferBox() {
    const s = NextUpStore.computeSummary(DATA);
    document.getElementById('ovRecWeekly').textContent = fmt(s.recommendedWeeklyTransfer);
    document.getElementById('ovRecMonthly').textContent = fmt(s.recommendedMonthlyTransfer);
    document.getElementById('ovRecBiweekly').textContent = fmt(s.recommendedBiweeklyTransfer);
    const useAmount = DATA.settings.customTransferAmount != null && DATA.settings.customTransferAmount !== '' ? Number(DATA.settings.customTransferAmount) : null;
    const freq = DATA.settings.customTransferFrequency || 'weekly';
    const val = useAmount != null ? useAmount : (freq === 'weekly' ? s.recommendedWeeklyTransfer : freq === 'biweekly' ? s.recommendedBiweeklyTransfer : s.recommendedMonthlyTransfer);
    document.getElementById('ovYourTransfer').textContent = `${fmt(val)} / ${freq}`;
    const billPayStat = document.getElementById('ovBillPayStat');
    const billPayStatFreq = document.getElementById('ovBillPayStatFreq');
    if (billPayStat) billPayStat.textContent = fmt(val);
    if (billPayStatFreq) billPayStatFreq.textContent = `Move this ${freq} into your Bill Pay Account`;
  }

  function renderUpcoming() {
    const el = document.getElementById('ovUpcoming');
    const today = new Date(); today.setHours(0,0,0,0);
    const items = [];
    for (let offset = 0; offset < 8; offset++) {
      const d = new Date(today); d.setDate(d.getDate() + offset);
      const ev = NextUpStore.buildCalendarEvents(DATA, d.getFullYear(), d.getMonth())
        .filter(e => e.date.toDateString() === d.toDateString());
      ev.forEach(e => items.push(e));
      if (items.length > 40) break;
    }
    if (!items.length) { el.innerHTML = `<div class="empty-state"><div class="ic">${ICON_CHECK}</div>Nothing due in the next week.</div>`; return; }
    el.innerHTML = items.slice(0, 10).map(e => `
      <div class="modal-item ${e.kind}">
        <div><div class="name">${escapeHtml(e.name)}</div><div style="font-size:11px;color:var(--text-faint);">${e.date.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'})}</div></div>
        <div class="amt">${e.sign>0?'+':'-'}${fmt(e.amount)}</div>
      </div>`).join('');
  }

  function renderDebtSummaryMini() {
    const el = document.getElementById('ovDebtSummary');
    const active = DATA.debts.filter(d => !d.noBalance && Number(d.balance) > 0);
    if (!active.length) { el.innerHTML = `<div class="empty-state"><div class="ic">${ICON_CHECK}</div>No tracked debt — you're clear!</div>`; return; }
    const sim = NextUpStore.simulateSnowball(DATA.debts, DATA.settings.snowballExtra);
    const totalBalance = active.reduce((s, d) => s + Number(d.balance), 0);
    const top3 = [...active].sort((a,b) => a.balance - b.balance).slice(0, 3);
    el.innerHTML = `
      <div style="display:flex;justify-content:space-between;margin-bottom:12px;">
        <div><div style="font-size:12px;color:var(--text-faint);">Total balance</div><div style="font-size:20px;font-weight:800;color:var(--debt-red)">${fmt(totalBalance)}</div></div>
        <div style="text-align:right;"><div style="font-size:12px;color:var(--text-faint);">Debt-free by</div><div style="font-size:20px;font-weight:800;color:var(--income-green)">${sim.debtFreeDate ? sim.debtFreeDate.toLocaleDateString('en-US',{month:'short',year:'numeric'}) : '—'}</div></div>
      </div>
      ${top3.map((d,i) => `
        <div class="modal-item">
          <div><div class="name">${i+1}. ${escapeHtml(d.name)}</div><div style="font-size:11px;color:var(--text-faint);">${fmt(NextUpStore.debtMonthlyPayment(d))}/mo</div></div>
          <div class="amt" style="color:var(--debt-red)">${fmt(d.balance)}</div>
        </div>`).join('')}
      <div style="margin-top:10px;"><a href="#" id="ovGoDebts" style="color:var(--chase-blue);font-weight:700;font-size:13px;">Open full debt snowball →</a></div>
    `;
    document.getElementById('ovGoDebts').addEventListener('click', (e) => { e.preventDefault(); switchTab('debts'); });
  }

  function exportData() {
    const blob = new Blob([JSON.stringify(DATA, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'nextup-bill-pay-ledger.json'; a.click();
    URL.revokeObjectURL(url);
  }
  function importData(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        DATA = parsed; persist();
        switchTab('overview'); toast('Data imported');
      } catch (err) { alert('That file could not be read as valid ledger JSON.'); }
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  // ================================================================
  // INCOME
  // ================================================================
  function renderIncome() {
    const root = document.getElementById('tab-income');
    const totalM = DATA.income.reduce((s, i) => s + NextUpStore.toMonthly(i.amount, i.frequency), 0);
    const totalW = totalM / NextUpStore.WEEK_PER_MONTH;
    root.innerHTML = `
      <div class="stat-grid stat-grid-3">
        <div class="stat-card positive"><div class="lbl">Total Personal Income</div><div class="val" id="incomeTotalMonthly">${fmt(totalM)}/mo</div></div>
        <div class="stat-card positive"><div class="lbl">Weekly Equivalent</div><div class="val" id="incomeTotalWeekly">${fmt(totalW)}/wk</div></div>
        <div class="stat-card"><div class="lbl">Sources</div><div class="val">${DATA.income.length}</div></div>
      </div>
      <div class="card">
        <div class="card-head"><h3>Income Sources</h3><span class="sub">W2 paychecks, 1099s, anything that comes in</span></div>
        <div class="table-wrap"><table class="table">
          <thead><tr><th>Name</th><th>Type</th><th>Amount</th><th>Schedule</th><th>Notes</th><th></th></tr></thead>
          <tbody>${DATA.income.map(i => incomeRow(i)).join('')}</tbody>
        </table></div>
        <div class="inline-form" id="addIncomeForm">
          <div class="field grow-2"><label>Name</label><input class="field-input" id="newIncName" placeholder="e.g. Trucking paycheck"></div>
          <div class="field"><label>Type</label>
            <select class="field-input" id="newIncType"><option value="w2">W2</option><option value="self-employed">Self-employed</option><option value="other">Other</option></select>
          </div>
          <div class="field"><label>Amount</label><input class="field-input" type="number" step="0.01" id="newIncAmount" placeholder="0.00"></div>
          <div class="field"><label>Frequency</label>
            <select class="field-input" id="newIncFreq"><option value="weekly">Weekly</option><option value="biweekly">Biweekly</option><option value="monthly">Monthly</option></select>
          </div>
          <button class="btn btn-primary" id="addIncomeBtn">+ Add Income</button>
        </div>
      </div>
    `;
    document.getElementById('addIncomeBtn').addEventListener('click', () => {
      const name = document.getElementById('newIncName').value.trim();
      const amount = parseFloat(document.getElementById('newIncAmount').value) || 0;
      if (!name) { toast('Give it a name first'); return; }
      DATA.income.push({
        id: NextUpStore.uid('inc'), name, owner: 'personal',
        type: document.getElementById('newIncType').value,
        amount, frequency: document.getElementById('newIncFreq').value,
        weekday: 5, dueDay: 1, notes: ''
      });
      persist(); renderIncome(); toast('Income added');
    });
  }

  function incomeRow(item) {
    const isW2 = item.type === 'w2';
    const computed = isW2 && item.payStructure && item.payStructure !== 'none';
    const open = incomePayOpenIds.has(item.id);
    const row = `<tr data-row-id="${item.id}">
      <td><input class="cell-input" data-kind="income" data-id="${item.id}" data-field="name" value="${escapeHtml(item.name)}"></td>
      <td><select class="cell-input" data-kind="income" data-id="${item.id}" data-field="type" data-refresh="tab">
        <option value="w2" ${item.type==='w2'?'selected':''}>W2</option>
        <option value="self-employed" ${item.type==='self-employed'?'selected':''}>Self-employed</option>
        <option value="other" ${item.type==='other'?'selected':''}>Other</option>
      </select></td>
      <td class="amt-cell">
        <input class="cell-input" type="number" step="0.01" data-kind="income" data-id="${item.id}" data-field="amount" data-parse="number" data-live="income" value="${Number(item.amount).toFixed(2)}" ${computed ? 'readonly title="Computed from pay structure below — use Edit pay setup to change"' : ''}>
        ${isW2 ? `<button type="button" class="link-btn income-pay-toggle" data-id="${item.id}" style="display:block;font-size:11px;margin-top:3px;background:none;border:none;color:var(--chase-blue);cursor:pointer;padding:0;">${open ? 'Hide pay setup ▴' : (computed ? 'Edit pay setup ▾' : 'Set up pay ▾')}</button>` : ''}
      </td>
      <td>${scheduleFieldsHTML('income', item.id, item, [{v:'weekly',l:'Weekly'},{v:'biweekly',l:'Biweekly'},{v:'monthly',l:'Monthly'}])}</td>
      <td><input class="cell-input" data-kind="income" data-id="${item.id}" data-field="notes" value="${escapeHtml(item.notes||'')}" placeholder="—"></td>
      <td class="row-actions"><button class="icon-btn" data-delete="income" data-id="${item.id}">✕</button></td>
    </tr>`;
    return row + (isW2 && open ? incomePayPanelRow(item) : '');
  }

  function incomePayPanelRow(item) {
    const ps = item.payStructure || 'none';
    return `<tr class="income-pay-panel">
      <td colspan="6" style="background:var(--bg-soft, #f7f9fc);">
        <div class="debt-meta-grid" style="margin-top:10px;margin-bottom:6px;">
          <div class="field"><label>Pay structure</label>
            <select class="cell-input" data-kind="income" data-id="${item.id}" data-field="payStructure" data-refresh="tab">
              <option value="none" ${ps==='none'?'selected':''}>Manual amount</option>
              <option value="salary" ${ps==='salary'?'selected':''}>Annual salary</option>
              <option value="hourly" ${ps==='hourly'?'selected':''}>Hourly</option>
            </select>
          </div>
          ${ps === 'salary' ? `<div class="field"><label>Annual salary (gross)</label><input class="cell-input" type="number" step="0.01" data-kind="income" data-id="${item.id}" data-field="annualSalary" data-parse="number" data-live="incomepay" value="${item.annualSalary||0}"></div>` : ''}
          ${ps === 'hourly' ? `<div class="field"><label>Hourly rate</label><input class="cell-input" type="number" step="0.01" data-kind="income" data-id="${item.id}" data-field="hourlyRate" data-parse="number" data-live="incomepay" value="${item.hourlyRate||0}"></div>
          <div class="field"><label>Hours / week</label><input class="cell-input" type="number" step="0.5" data-kind="income" data-id="${item.id}" data-field="hoursPerWeek" data-parse="number" data-live="incomepay" value="${item.hoursPerWeek||0}"></div>` : ''}
          ${ps !== 'none' ? `<div class="field"><label>Est. tax/insurance/retirement withheld (%)</label><input class="cell-input" type="number" step="0.1" min="0" max="100" data-kind="income" data-id="${item.id}" data-field="taxRatePercent" data-parse="number" data-live="incomepay" value="${item.taxRatePercent||0}"></div>` : ''}
        </div>
        ${ps !== 'none' ? `
        <label style="display:flex;align-items:center;gap:8px;font-size:12.5px;color:var(--text-muted);font-weight:600;margin-top:2px;">
          <input type="checkbox" data-kind="income" data-id="${item.id}" data-field="useYtdAverage" data-parse="bool" data-refresh="tab" ${item.useYtdAverage?'checked':''}>
          Use YTD average instead of the fields above
        </label>
        ${item.useYtdAverage ? `<div class="debt-meta-grid" style="margin-top:10px;">
          <div class="field"><label>YTD gross earned</label><input class="cell-input" type="number" step="0.01" data-kind="income" data-id="${item.id}" data-field="ytdGross" data-parse="number" data-live="incomepay" value="${item.ytdGross||0}"></div>
          <div class="field"><label>YTD start date</label><input class="cell-input" type="date" data-kind="income" data-id="${item.id}" data-field="ytdStartDate" data-live="incomepay" value="${item.ytdStartDate||''}"></div>
        </div>` : ''}
        <div class="incomepay-net" data-id="${item.id}" style="margin-top:10px;font-size:12.5px;color:var(--text-faint);">Estimated net pay: <strong style="color:var(--income-green);">${NextUpStore.fmtMoney(item.amount)}</strong> / ${item.frequency} (this is an estimate — check your actual pay stub for exact withholding)</div>
        ` : `<div style="margin-top:8px;font-size:12px;color:var(--text-faint);">Manual amount mode — edit the Amount field directly in the row above.</div>`}
      </td>
    </tr>`;
  }

  // ================================================================
  // BILLS
  // ================================================================
  function renderBills() {
    const root = document.getElementById('tab-bills');
    const totalM = DATA.bills.reduce((s, b) => s + NextUpStore.toMonthly(b.amount, b.frequency), 0);
    const totalW = totalM / NextUpStore.WEEK_PER_MONTH;
    root.innerHTML = `
      <div class="stat-grid stat-grid-3">
        <div class="stat-card"><div class="lbl">Total Bills</div><div class="val" id="billsTotalMonthly">${fmt(totalM)}/mo</div></div>
        <div class="stat-card"><div class="lbl">Weekly Equivalent</div><div class="val" id="billsTotalWeekly">${fmt(totalW)}/wk</div></div>
        <div class="stat-card"><div class="lbl">Bills Tracked</div><div class="val">${DATA.bills.length}</div></div>
      </div>
      <div class="card">
        <div class="card-head"><h3>All Bills</h3><span class="sub">Fixed costs — not debt, not business</span></div>
        <div class="table-wrap"><table class="table">
          <thead><tr><th>Name</th><th>Amount</th><th>Schedule</th><th>Status</th><th>Notes</th><th></th></tr></thead>
          <tbody>${DATA.bills.map(b => billRow(b)).join('')}</tbody>
        </table></div>
        <div class="inline-form">
          <div class="field grow-2"><label>Name</label><input class="field-input" id="newBillName" placeholder="e.g. Electric"></div>
          <div class="field"><label>Amount</label><input class="field-input" type="number" step="0.01" id="newBillAmount" placeholder="0.00"></div>
          <div class="field"><label>Frequency</label>
            <select class="field-input" id="newBillFreq">
              <option value="monthly">Monthly</option><option value="weekly">Weekly</option><option value="biweekly">Biweekly</option><option value="onetime">One-time</option>
            </select>
          </div>
          <div class="field"><label>Status</label>
            <select class="field-input" id="newBillStatus"><option value="active">Autopay active</option><option value="pending">Pending setup</option><option value="manual">Manual payment</option></select>
          </div>
          <button class="btn btn-primary" id="addBillBtn">+ Add Bill</button>
        </div>
      </div>
    `;
    document.getElementById('addBillBtn').addEventListener('click', () => {
      const name = document.getElementById('newBillName').value.trim();
      const amount = parseFloat(document.getElementById('newBillAmount').value) || 0;
      if (!name) { toast('Give it a name first'); return; }
      DATA.bills.push({
        id: NextUpStore.uid('bill'), name, amount,
        frequency: document.getElementById('newBillFreq').value,
        weekday: 5, dueDay: 1, status: document.getElementById('newBillStatus').value, notes: ''
      });
      persist(); renderBills(); toast('Bill added');
    });
  }

  function statusOptions(kind, id, current) {
    return `<select class="cell-input" data-kind="${kind}" data-id="${id}" data-field="status" data-refresh="tab">
      <option value="active" ${current==='active'?'selected':''}>Autopay active</option>
      <option value="pending" ${current==='pending'?'selected':''}>Pending setup</option>
      <option value="manual" ${current==='manual'?'selected':''}>Manual payment</option>
      ${kind==='debts'?`<option value="paused" ${current==='paused'?'selected':''}>Paused</option>`:''}
    </select>`;
  }
  function statusPill(status) {
    const map = { active: ['pill-active','Autopay active'], pending: ['pill-pending','Pending setup'], manual: ['pill-manual','Manual'], paused: ['pill-paused','Paused'] };
    const [cls, label] = map[status] || ['pill-pending', status || '—'];
    return `<span class="pill ${cls}">${label}</span>`;
  }

  function billRow(item) {
    return `<tr data-row-id="${item.id}">
      <td><input class="cell-input" data-kind="bills" data-id="${item.id}" data-field="name" value="${escapeHtml(item.name)}"></td>
      <td class="amt-cell"><input class="cell-input" type="number" step="0.01" data-kind="bills" data-id="${item.id}" data-field="amount" data-parse="number" data-live="bills" value="${item.amount}"></td>
      <td>${scheduleFieldsHTML('bills', item.id, item, [{v:'monthly',l:'Monthly'},{v:'weekly',l:'Weekly'},{v:'biweekly',l:'Biweekly'},{v:'monthly-nth-weekday',l:'Nth weekday'},{v:'onetime',l:'One-time'}])}</td>
      <td>${statusOptions('bills', item.id, item.status)}</td>
      <td><input class="cell-input" data-kind="bills" data-id="${item.id}" data-field="notes" value="${escapeHtml(item.notes||'')}" placeholder="—"></td>
      <td class="row-actions"><button class="icon-btn" data-delete="bills" data-id="${item.id}">✕</button></td>
    </tr>`;
  }

  // ================================================================
  // DEBTS
  // ================================================================
  const DEBT_CATS = [
    { v: 'credit-card', l: 'Credit card' }, { v: 'bnpl', l: 'Buy now, pay later' }, { v: 'collections', l: 'Collections' },
    { v: 'tax', l: 'Tax debt' }, { v: 'student-loan', l: 'Student loan' }, { v: 'legal', l: 'Legal' }, { v: 'mortgage', l: 'Mortgage' }
  ];
  function catLabel(v) { return (DEBT_CATS.find(c => c.v === v) || {}).l || v; }

  function renderDebts() {
    const root = document.getElementById('tab-debts');
    const withBalance = DATA.debts.filter(d => !d.noBalance);
    const active = withBalance.filter(d => Number(d.balance) > 0).sort((a,b) => a.balance - b.balance);
    const paused = DATA.debts.filter(d => d.noBalance || Number(d.balance) <= 0);
    if (openDebtIds === null) {
      openDebtIds = new Set();
      if (active[0]) openDebtIds.add(active[0].id);
    }
    const totalBalance = active.reduce((s,d) => s + Number(d.balance), 0);
    const activeMonthly = DATA.debts.filter(d => d.status !== 'paused').reduce((s,d) => s + NextUpStore.debtMonthlyPayment(d), 0);
    const sim = NextUpStore.simulateSnowball(DATA.debts, DATA.settings.snowballExtra);
    const catTotals = NextUpStore.debtTotalsByCategory(DATA.debts);

    root.innerHTML = `
      <div class="stat-grid" id="debtStatGrid">${debtStatGridHtml(totalBalance, activeMonthly, DATA.debts.length, sim)}</div>

      <div class="card">
        <div class="card-head"><h3>Snowball Accelerator</h3><span class="sub">Extra dollars roll to the smallest balance first, then cascade</span></div>
        <div class="field" style="max-width:260px;">
          <label>Extra toward debt / month</label>
          <input class="field-input" type="number" step="0.01" min="0" id="snowballExtra" value="${DATA.settings.snowballExtra || 0}">
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h3>Totals by Category</h3></div>
        <div class="table-wrap"><table class="table">
          <thead><tr><th>Category</th><th># Debts</th><th>Total Balance</th><th>Monthly Payment</th></tr></thead>
          <tbody>${Object.keys(catTotals).map(cat => `
            <tr><td>${catLabel(cat)}</td><td>${catTotals[cat].count}</td><td>${fmt(catTotals[cat].balance)}</td><td>${fmt(catTotals[cat].monthly)}/mo</td></tr>
          `).join('')}</tbody>
        </table></div>
      </div>

      <div class="section-title">Snowball Order — Smallest to Largest</div>
      <div id="debtCards">${active.map((d, i) => debtCardHtml(d, i + 1)).join('') || `<div class="empty-state"><div class="ic">${ICON_CHECK}</div>No active balances — nice work.</div>`}</div>

      ${paused.length ? `<div class="section-title">Paused, No Balance, or Payment-Plan Debts</div><div id="debtPausedCards">${paused.map(d => debtCardHtml(d, null)).join('')}</div>` : ''}

      <div class="card">
        <div class="card-head"><h3>Add a Debt</h3></div>
        <div class="inline-form" style="border-top:none;padding-top:0;">
          <div class="field grow-2"><label>Name</label><input class="field-input" id="newDebtName" placeholder="e.g. Discover Card"></div>
          <div class="field"><label>Category</label><select class="field-input" id="newDebtCat">${DEBT_CATS.map(c => `<option value="${c.v}">${c.l}</option>`).join('')}</select></div>
          <div class="field"><label>Balance</label><input class="field-input" type="number" step="0.01" id="newDebtBalance" placeholder="0.00"></div>
          <div class="field"><label>Interest Rate (APR %)</label><input class="field-input" type="number" step="0.01" id="newDebtApr" placeholder="0.00"></div>
          <div class="field"><label>Min Payment / mo</label><input class="field-input" type="number" step="0.01" id="newDebtMin" placeholder="0.00"></div>
          <button class="btn btn-primary" id="addDebtBtn">+ Add Debt</button>
        </div>
      </div>
    `;

    document.getElementById('snowballExtra').addEventListener('input', (e) => {
      DATA.settings.snowballExtra = parseFloat(e.target.value) || 0;
      persist();
      updateDebtStatGrid();
    });
    document.getElementById('addDebtBtn').addEventListener('click', () => {
      const name = document.getElementById('newDebtName').value.trim();
      if (!name) { toast('Give it a name first'); return; }
      DATA.debts.push({
        id: NextUpStore.uid('debt'), name, debtCategory: document.getElementById('newDebtCat').value,
        balance: parseFloat(document.getElementById('newDebtBalance').value) || 0,
        startBalance: parseFloat(document.getElementById('newDebtBalance').value) || 0,
        interestRate: parseFloat(document.getElementById('newDebtApr').value) || 0,
        minPayment: parseFloat(document.getElementById('newDebtMin').value) || 0,
        extraPayment: 0, frequency: 'monthly', dueDay: 1, status: 'active', notes: ''
      });
      persist(); renderDebts(); toast('Debt added');
    });

    applyDebtCardOpenStates(root);
    root.querySelectorAll('.debt-card-header[data-debt-toggle]').forEach(header => {
      header.addEventListener('click', (e) => {
        if (e.target.closest('input, button, select, a')) return;
        toggleDebtCard(header.dataset.debtToggle);
      });
    });
  }

  function applyDebtCardOpenStates(root) {
    root.querySelectorAll('.debt-card').forEach(card => {
      if (openDebtIds.has(card.dataset.debtId)) {
        card.classList.add('open');
        const body = card.querySelector('.debt-card-body');
        if (body) body.style.maxHeight = body.scrollHeight + 'px';
      }
    });
  }

  function toggleDebtCard(id) {
    const card = document.querySelector(`.debt-card[data-debt-id="${id}"]`);
    if (!card) return;
    const body = card.querySelector('.debt-card-body');
    if (card.classList.contains('open')) {
      card.classList.remove('open');
      if (body) body.style.maxHeight = '0px';
      openDebtIds.delete(id);
    } else {
      card.classList.add('open');
      if (body) body.style.maxHeight = body.scrollHeight + 'px';
      openDebtIds.add(id);
    }
  }

  function debtStatGridHtml(totalBalance, activeMonthly, count, sim) {
    return `
      <div class="stat-card negative"><div class="lbl">Total Debt Tracked</div><div class="val" id="debtTotalBalance">${fmt(totalBalance)}</div></div>
      <div class="stat-card"><div class="lbl">Active Monthly Payments</div><div class="val" id="debtActiveMonthly">${fmt(activeMonthly)}</div></div>
      <div class="stat-card"><div class="lbl">Debts Tracked</div><div class="val" id="debtCount">${count}</div></div>
      <div class="stat-card positive"><div class="lbl">Projected Debt-Free</div><div class="val" id="debtFreeDateStat">${sim.debtFreeDate ? sim.debtFreeDate.toLocaleDateString('en-US',{month:'short',year:'numeric'}) : '—'}</div></div>
    `;
  }

  function updateDebtStatGrid() {
    const withBalance = DATA.debts.filter(d => !d.noBalance);
    const active = withBalance.filter(d => Number(d.balance) > 0);
    const totalBalance = active.reduce((s,d) => s + Number(d.balance), 0);
    const activeMonthly = DATA.debts.filter(d => d.status !== 'paused').reduce((s,d) => s + NextUpStore.debtMonthlyPayment(d), 0);
    const sim = NextUpStore.simulateSnowball(DATA.debts, DATA.settings.snowballExtra);
    document.getElementById('debtStatGrid').innerHTML = debtStatGridHtml(totalBalance, activeMonthly, DATA.debts.length, sim);
  }

  function debtCardHtml(d, rank) {
    const progress = NextUpStore.debtProgress(d);
    const payoff = NextUpStore.debtPayoffEstimate(d);
    const monthlyPay = NextUpStore.debtMonthlyPayment(d);
    return `
      <div class="debt-card" data-debt-id="${d.id}">
        <div class="debt-card-header" data-debt-toggle="${d.id}">
          <div class="debt-card-top">
            <div class="debt-name-row">
              ${rank ? `<div class="debt-rank">${rank}</div>` : ''}
              <div>
                <input class="cell-input" style="font-size:15.5px;font-weight:700;padding:2px 4px;" data-kind="debts" data-id="${d.id}" data-field="name" value="${escapeHtml(d.name)}">
                <div><span class="pill pill-debt">${catLabel(d.debtCategory)}</span> ${d.pastDue ? `<span class="pill" style="background:#fdeaea;color:#b42318;">Past due ${fmt(d.pastDue)}</span>` : ''}</div>
              </div>
            </div>
            <div style="text-align:right;display:flex;align-items:center;gap:10px;">
              <div>
                ${d.noBalance ? `<div style="font-size:13px;color:var(--text-faint);">No fixed balance</div>` :
                  `<div class="debt-balance" id="balDisplay_${d.id}">${fmt(d.balance)}</div>`}
                <div class="row-actions" style="margin-top:4px;justify-content:flex-end;"><button class="icon-btn" data-delete="debts" data-id="${d.id}">✕</button></div>
              </div>
              <span class="chev"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><path d="M6 9l6 6 6-6"/></svg></span>
            </div>
          </div>
        </div>

        <div class="debt-card-body">
          ${!d.noBalance ? `
          <div class="progress-track"><div class="progress-fill" id="progressFill_${d.id}" style="width:${progress.toFixed(1)}%"></div></div>
          <div style="font-size:11.5px;color:var(--text-faint);margin-top:4px;" id="progressText_${d.id}">${progress.toFixed(1)}% paid off since added</div>
          ` : ''}

          <div class="debt-meta-grid">
            ${d.noBalance ? '' : `<div class="field"><label>Balance</label><input class="cell-input" type="number" step="0.01" data-kind="debts" data-id="${d.id}" data-field="balance" data-parse="number" data-live="debt" value="${d.balance}"></div>`}
            <div class="field"><label>Interest Rate (APR %)</label><input class="cell-input" type="number" step="0.01" data-kind="debts" data-id="${d.id}" data-field="interestRate" data-parse="number" data-live="debt" value="${d.interestRate || 0}"></div>
            <div class="field"><label>Min Payment / mo</label><input class="cell-input" type="number" step="0.01" data-kind="debts" data-id="${d.id}" data-field="minPayment" data-parse="number" data-live="debt" value="${d.minPayment || 0}"></div>
            <div class="field"><label>Extra Payment / mo</label><input class="cell-input" type="number" step="0.01" data-kind="debts" data-id="${d.id}" data-field="extraPayment" data-parse="number" data-live="debt" value="${d.extraPayment || 0}"></div>
          </div>

          <div class="debt-foot">
            <span>Status: ${statusOptions('debts', d.id, d.status)}</span>
            <span>Paying <strong id="monthlyPay_${d.id}">${fmt(monthlyPay)}</strong>/mo → payoff est. <strong id="payoffText_${d.id}">${d.noBalance ? (d.targetDate ? new Date(d.targetDate).toLocaleDateString('en-US',{month:'short',year:'numeric'}) : '—') : (payoff.date ? payoff.date.toLocaleDateString('en-US',{month:'short',year:'numeric'}) : (payoff.months === Infinity ? 'never at this rate' : '—'))}</strong></span>
          </div>
        </div>
      </div>
    `;
  }

  function updateDebtCardComputed(id) {
    const d = findItem('debts', id);
    if (!d) return;
    if (!d.noBalance) {
      const progress = NextUpStore.debtProgress(d);
      const fill = document.getElementById('progressFill_' + id);
      const text = document.getElementById('progressText_' + id);
      const balDisplay = document.getElementById('balDisplay_' + id);
      if (fill) fill.style.width = progress.toFixed(1) + '%';
      if (text) text.textContent = progress.toFixed(1) + '% paid off since added';
      if (balDisplay) balDisplay.textContent = fmt(d.balance);
    }
    const payoff = NextUpStore.debtPayoffEstimate(d);
    const monthlyPay = NextUpStore.debtMonthlyPayment(d);
    const mpEl = document.getElementById('monthlyPay_' + id);
    const poEl = document.getElementById('payoffText_' + id);
    if (mpEl) mpEl.textContent = fmt(monthlyPay);
    if (poEl) poEl.textContent = d.noBalance ? (d.targetDate ? new Date(d.targetDate).toLocaleDateString('en-US',{month:'short',year:'numeric'}) : '—') : (payoff.date ? payoff.date.toLocaleDateString('en-US',{month:'short',year:'numeric'}) : (payoff.months === Infinity ? 'never at this rate' : '—'));
    updateDebtStatGrid();
    const card = document.querySelector(`.debt-card[data-debt-id="${id}"]`);
    if (card && card.classList.contains('open')) {
      const body = card.querySelector('.debt-card-body');
      if (body) body.style.maxHeight = body.scrollHeight + 'px';
    }
  }

  // ================================================================
  // BUSINESS
  // ================================================================
  function renderBusiness() {
    const root = document.getElementById('tab-business');
    const incomeM = DATA.business.income.reduce((s,i) => s + NextUpStore.toMonthly(i.amount, i.frequency), 0);
    const expM = DATA.business.expenses.reduce((s,e) => s + NextUpStore.toMonthly(e.amount, e.frequency), 0);
    const net = incomeM - expM;
    const weeklyTransfer = net < 0 ? (-net) / NextUpStore.WEEK_PER_MONTH : 0;
    const pnl = NextUpStore.computeBusinessPnL(DATA, pnlPeriod, pnlCustomStart, pnlCustomEnd);
    const periodLabel = { week: 'This week', month: 'This month', year: 'This year', custom: 'Custom range' }[pnlPeriod];

    root.innerHTML = `
      <div class="card">
        <div class="card-head">
          <h3>Profit &amp; Loss</h3>
          <span class="sub">${periodLabel} · ${pnl.start.toLocaleDateString('en-US',{month:'short',day:'numeric'})} &ndash; ${pnl.end.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}</span>
          <button class="btn btn-secondary btn-sm" id="btnExportPnlPdf" style="margin-left:auto;">Export PDF</button>
        </div>
        <div class="freq-toggle" id="pnlPeriodToggle">
          <button data-period="week" class="${pnlPeriod==='week'?'active':''}">Week</button>
          <button data-period="month" class="${pnlPeriod==='month'?'active':''}">Month</button>
          <button data-period="year" class="${pnlPeriod==='year'?'active':''}">Year</button>
          <button data-period="custom" class="${pnlPeriod==='custom'?'active':''}">Custom</button>
        </div>
        ${pnlPeriod === 'custom' ? `
          <div class="inline-form" style="margin-top:12px;">
            <div class="field"><label>Start</label><input class="field-input" type="date" id="pnlCustomStart" value="${pnlCustomStart || ''}"></div>
            <div class="field"><label>End</label><input class="field-input" type="date" id="pnlCustomEnd" value="${pnlCustomEnd || ''}"></div>
          </div>
        ` : ''}
        <div class="stat-grid" style="margin-top:16px;">
          <div class="stat-card positive"><div class="lbl">Income (period)</div><div class="val" id="pnlIncome">${fmt(pnl.totalIncome)}</div></div>
          <div class="stat-card"><div class="lbl">Expenses (period)</div><div class="val" id="pnlExpense">${fmt(pnl.totalExpense)}</div></div>
          <div class="stat-card ${pnl.net>=0?'positive':'negative'}"><div class="lbl">Net Profit</div><div class="val" id="pnlNet">${fmt(pnl.net)}</div></div>
        </div>
        <div style="margin-top:16px;">
          <div class="sub" style="margin-bottom:8px;">Expense breakdown by category</div>
          <div class="table-wrap" id="pnlCategoryWrap">${categoryBreakdownHtml(pnl.categoryTotals)}</div>
        </div>
        <div class="inline-form" id="addTxnForm" style="margin-top:16px;border-top:1px dashed var(--border);padding-top:14px;">
          <div class="field"><label>Type</label><select class="field-input" id="newTxnType"><option value="expense">Expense</option><option value="income">Income</option></select></div>
          <div class="field"><label>Date</label><input class="field-input" type="date" id="newTxnDate" value="${new Date().toISOString().slice(0,10)}"></div>
          <div class="field grow-2"><label>Name</label><input class="field-input" id="newTxnName" placeholder="e.g. Gas for client visit"></div>
          <div class="field"><label>Amount</label><input class="field-input" type="number" step="0.01" id="newTxnAmount" placeholder="0.00"></div>
          <div class="field" id="newTxnCategoryWrap"><label>Category</label>
            <select class="field-input" id="newTxnCategory">${NextUpStore.EXPENSE_CATEGORIES.map(c => `<option value="${c}">${c}</option>`).join('')}</select>
          </div>
          <div class="field" id="newTxnCategoryOtherWrap" style="display:none;"><label>Custom category</label><input class="field-input" id="newTxnCategoryOther" placeholder="Type a category"></div>
          <button class="btn btn-primary" id="addTxnBtn">+ Log transaction</button>
        </div>
        ${pnl.txns.length ? `
          <div class="table-wrap" style="margin-top:14px;"><table class="table table-compact">
            <thead><tr><th>Date</th><th>Name</th><th>Category</th><th>Amount</th><th></th></tr></thead>
            <tbody>${pnl.txns.slice().sort((a,b)=>new Date(b.date)-new Date(a.date)).map(t => txnRow(t)).join('')}</tbody>
          </table></div>
        ` : `<div class="empty-state" style="padding:14px 0;">No logged transactions in this period.</div>`}
      </div>

      <div class="stat-grid">
        <div class="stat-card positive"><div class="lbl">Business Income</div><div class="val" id="bizIncomeTotal">${fmt(incomeM)}/mo</div></div>
        <div class="stat-card"><div class="lbl">Business Expenses</div><div class="val" id="bizExpenseTotal">${fmt(expM)}/mo</div></div>
        <div class="stat-card ${net>=0?'positive':'negative'}"><div class="lbl">Net Position</div><div class="val" id="bizNet">${fmt(net)}/mo</div></div>
        <div class="stat-card accent"><div class="lbl">Weekly Transfer Needed</div><div class="val" id="bizWeeklyTransfer">${fmt(weeklyTransfer)}/wk</div><div class="note">From personal, to cover the gap</div></div>
      </div>

      <div class="card">
        <div class="card-head"><h3>Fixed Recurring Income</h3><span class="sub">NextUp Enterprise clients &amp; transfers in — always editable</span></div>
        <div class="table-wrap"><table class="table">
          <thead><tr><th>Name</th><th>Amount</th><th>Schedule</th><th>Notes</th><th></th></tr></thead>
          <tbody>${DATA.business.income.map(i => bizIncomeRow(i)).join('')}</tbody>
        </table></div>
        <div class="inline-form">
          <div class="field grow-2"><label>Name</label><input class="field-input" id="newBizIncName" placeholder="e.g. New client"></div>
          <div class="field"><label>Amount</label><input class="field-input" type="number" step="0.01" id="newBizIncAmount" placeholder="0.00"></div>
          <div class="field"><label>Frequency</label><select class="field-input" id="newBizIncFreq"><option value="monthly">Monthly</option><option value="weekly">Weekly</option><option value="biweekly">Biweekly</option></select></div>
          <button class="btn btn-primary" id="addBizIncBtn">+ Add Income</button>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h3>Fixed Recurring Expenses</h3><span class="sub">Software, office, tools — always editable</span></div>
        <div class="table-wrap"><table class="table">
          <thead><tr><th>Name</th><th>Amount</th><th>Schedule</th><th>Status</th><th></th></tr></thead>
          <tbody>${DATA.business.expenses.map(e => bizExpenseRow(e)).join('')}</tbody>
        </table></div>
        <div class="inline-form">
          <div class="field grow-2"><label>Name</label><input class="field-input" id="newBizExpName" placeholder="e.g. Software subscription"></div>
          <div class="field"><label>Amount</label><input class="field-input" type="number" step="0.01" id="newBizExpAmount" placeholder="0.00"></div>
          <div class="field"><label>Frequency</label><select class="field-input" id="newBizExpFreq"><option value="monthly">Monthly</option><option value="weekly">Weekly</option><option value="biweekly">Biweekly</option><option value="onetime">One-time</option></select></div>
          <button class="btn btn-primary" id="addBizExpBtn">+ Add Expense</button>
        </div>
      </div>
    `;

    root.querySelectorAll('#pnlPeriodToggle button').forEach(b => {
      b.addEventListener('click', () => { pnlPeriod = b.dataset.period; renderBusiness(); });
    });
    const pnlStartEl = document.getElementById('pnlCustomStart');
    const pnlEndEl = document.getElementById('pnlCustomEnd');
    if (pnlStartEl) pnlStartEl.addEventListener('change', (e) => { pnlCustomStart = e.target.value; renderBusiness(); });
    if (pnlEndEl) pnlEndEl.addEventListener('change', (e) => { pnlCustomEnd = e.target.value; renderBusiness(); });

    const newTxnType = document.getElementById('newTxnType');
    const newTxnCategory = document.getElementById('newTxnCategory');
    newTxnType.addEventListener('change', (e) => {
      document.getElementById('newTxnCategoryWrap').style.display = e.target.value === 'expense' ? '' : 'none';
      document.getElementById('newTxnCategoryOtherWrap').style.display = 'none';
    });
    newTxnCategory.addEventListener('change', (e) => {
      document.getElementById('newTxnCategoryOtherWrap').style.display = e.target.value === 'Other' ? '' : 'none';
    });
    document.getElementById('addTxnBtn').addEventListener('click', () => {
      const name = document.getElementById('newTxnName').value.trim();
      if (!name) { toast('Give it a name first'); return; }
      const type = newTxnType.value;
      const amount = parseFloat(document.getElementById('newTxnAmount').value) || 0;
      const date = document.getElementById('newTxnDate').value || new Date().toISOString().slice(0,10);
      let category = null, categoryOther = '';
      if (type === 'expense') {
        category = newTxnCategory.value;
        if (category === 'Other') categoryOther = document.getElementById('newTxnCategoryOther').value.trim();
      }
      DATA.business.transactions.push({ id: NextUpStore.uid('txn'), type, name, amount, date, category, categoryOther, notes: '' });
      persist(); renderBusiness(); toast('Transaction logged');
    });

    document.getElementById('addBizIncBtn').addEventListener('click', () => {
      const name = document.getElementById('newBizIncName').value.trim();
      if (!name) { toast('Give it a name first'); return; }
      DATA.business.income.push({ id: NextUpStore.uid('bizinc'), name, owner: 'business', amount: parseFloat(document.getElementById('newBizIncAmount').value) || 0, frequency: document.getElementById('newBizIncFreq').value, weekday: 4, dueDay: 1, notes: '' });
      persist(); renderBusiness(); toast('Business income added');
    });
    document.getElementById('addBizExpBtn').addEventListener('click', () => {
      const name = document.getElementById('newBizExpName').value.trim();
      if (!name) { toast('Give it a name first'); return; }
      DATA.business.expenses.push({ id: NextUpStore.uid('bizexp'), name, amount: parseFloat(document.getElementById('newBizExpAmount').value) || 0, frequency: document.getElementById('newBizExpFreq').value, weekday: 4, dueDay: 1, status: 'active', notes: '' });
      persist(); renderBusiness(); toast('Business expense added');
    });

    document.getElementById('btnExportPnlPdf').addEventListener('click', () => exportPnlPdf(pnl, periodLabel));
  }

  function exportPnlPdf(pnl, periodLabel) {
    if (typeof window.jspdf === 'undefined') { toast('PDF library failed to load'); return; }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'pt', format: 'letter' });
    const marginX = 54;
    let y = 60;

    doc.setFont('helvetica', 'bold'); doc.setFontSize(18);
    doc.text('NextUp — Business Profit & Loss Statement', marginX, y);
    y += 22;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(11); doc.setTextColor(90);
    doc.text(`Prepared for: ${USER.name || USER.email}`, marginX, y); y += 15;
    doc.text(`Period: ${periodLabel} (${pnl.start.toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'})} – ${pnl.end.toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'})})`, marginX, y); y += 15;
    doc.text(`Generated: ${new Date().toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'})}`, marginX, y); y += 26;
    doc.setTextColor(0);

    doc.setDrawColor(220); doc.line(marginX, y, 558, y); y += 22;

    doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
    doc.text('Summary', marginX, y); y += 18;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(11);
    const rows = [
      ['Recurring income', NextUpStore.fmtMoney(pnl.recurringIncome)],
      ['Logged income transactions', NextUpStore.fmtMoney(pnl.txnIncome)],
      ['Total income', NextUpStore.fmtMoney(pnl.totalIncome)],
      ['Recurring expenses', NextUpStore.fmtMoney(pnl.recurringExpense)],
      ['Logged expense transactions', NextUpStore.fmtMoney(pnl.txnExpense)],
      ['Total expenses', NextUpStore.fmtMoney(pnl.totalExpense)],
    ];
    rows.forEach(([label, val]) => {
      doc.text(label, marginX, y);
      doc.text(val, 558, y, { align: 'right' });
      y += 16;
    });
    y += 6;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(12.5);
    doc.text('Net profit', marginX, y);
    doc.text(NextUpStore.fmtMoney(pnl.net), 558, y, { align: 'right' });
    y += 30;

    doc.setDrawColor(220); doc.line(marginX, y, 558, y); y += 22;

    doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
    doc.text('Expenses by category', marginX, y); y += 18;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(11);
    const cats = Object.keys(pnl.categoryTotals);
    if (!cats.length) {
      doc.setTextColor(120);
      doc.text('No expenses in this period.', marginX, y); y += 16;
      doc.setTextColor(0);
    } else {
      cats.forEach(cat => {
        doc.text(cat, marginX, y);
        doc.text(NextUpStore.fmtMoney(pnl.categoryTotals[cat]), 558, y, { align: 'right' });
        y += 16;
      });
    }
    y += 14;

    if (pnl.txns.length) {
      doc.setDrawColor(220); doc.line(marginX, y, 558, y); y += 22;
      doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
      doc.text('Logged transactions', marginX, y); y += 18;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
      pnl.txns.slice().sort((a,b) => new Date(a.date) - new Date(b.date)).forEach(t => {
        if (y > 730) { doc.addPage(); y = 60; }
        const dateStr = new Date(t.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        const label = `${dateStr} — ${t.name}${t.type === 'expense' ? ' (' + (t.category || 'Other') + ')' : ''}`;
        doc.text(label, marginX, y);
        doc.text((t.type === 'income' ? '+' : '-') + NextUpStore.fmtMoney(t.amount), 558, y, { align: 'right' });
        y += 14;
      });
    }

    doc.setFontSize(9); doc.setTextColor(150);
    doc.text('Generated by NextUp Bill Pay Ledger — for your own records. Not a substitute for tax or accounting advice.', marginX, 760);

    const fileSafeLabel = periodLabel.replace(/\s+/g, '-').toLowerCase();
    doc.save(`nextup-pnl-${fileSafeLabel}-${new Date().toISOString().slice(0,10)}.pdf`);
  }

  function categoryBreakdownHtml(categoryTotals) {
    const cats = Object.keys(categoryTotals);
    if (!cats.length) return `<div class="empty-state" style="padding:10px 0;">No expenses in this period.</div>`;
    return `<table class="table table-compact"><tbody>
      ${cats.map(c => `<tr><td>${escapeHtml(c)}</td><td class="amt-cell">${fmt(categoryTotals[c])}</td></tr>`).join('')}
    </tbody></table>`;
  }

  function txnRow(t) {
    return `<tr data-row-id="${t.id}">
      <td><input class="cell-input" type="date" data-kind="business.transactions" data-id="${t.id}" data-field="date" data-refresh="tab" value="${t.date || ''}"></td>
      <td><input class="cell-input" data-kind="business.transactions" data-id="${t.id}" data-field="name" value="${escapeHtml(t.name)}"></td>
      <td>${t.type === 'expense' ? `
        <select class="cell-input" data-kind="business.transactions" data-id="${t.id}" data-field="category" data-refresh="tab">
          ${NextUpStore.EXPENSE_CATEGORIES.map(c => `<option value="${c}" ${t.category===c?'selected':''}>${c}</option>`).join('')}
        </select>
        ${t.category === 'Other' ? `<input class="cell-input" style="margin-top:4px;" data-kind="business.transactions" data-id="${t.id}" data-field="categoryOther" placeholder="Custom category" value="${escapeHtml(t.categoryOther||'')}">` : ''}
      ` : `<span class="pill pill-income">Income</span>`}</td>
      <td class="amt-cell"><input class="cell-input" type="number" step="0.01" data-kind="business.transactions" data-id="${t.id}" data-field="amount" data-parse="number" data-live="business" value="${t.amount}"></td>
      <td class="row-actions"><button class="icon-btn" data-delete="business.transactions" data-id="${t.id}">✕</button></td>
    </tr>`;
  }

  function bizIncomeRow(item) {
    return `<tr data-row-id="${item.id}">
      <td><input class="cell-input" data-kind="business.income" data-id="${item.id}" data-field="name" value="${escapeHtml(item.name)}"></td>
      <td class="amt-cell"><input class="cell-input" type="number" step="0.01" data-kind="business.income" data-id="${item.id}" data-field="amount" data-parse="number" data-live="business" value="${item.amount}"></td>
      <td>${scheduleFieldsHTML('business.income', item.id, item, [{v:'monthly',l:'Monthly'},{v:'weekly',l:'Weekly'},{v:'biweekly',l:'Biweekly'}])}</td>
      <td><input class="cell-input" data-kind="business.income" data-id="${item.id}" data-field="notes" value="${escapeHtml(item.notes||'')}" placeholder="—"></td>
      <td class="row-actions"><button class="icon-btn" data-delete="business.income" data-id="${item.id}">✕</button></td>
    </tr>`;
  }
  function bizExpenseRow(item) {
    return `<tr data-row-id="${item.id}">
      <td><input class="cell-input" data-kind="business.expenses" data-id="${item.id}" data-field="name" value="${escapeHtml(item.name)}"></td>
      <td class="amt-cell"><input class="cell-input" type="number" step="0.01" data-kind="business.expenses" data-id="${item.id}" data-field="amount" data-parse="number" data-live="business" value="${item.amount}"></td>
      <td>${scheduleFieldsHTML('business.expenses', item.id, item, [{v:'monthly',l:'Monthly'},{v:'weekly',l:'Weekly'},{v:'biweekly',l:'Biweekly'},{v:'onetime',l:'One-time'}])}</td>
      <td>${statusOptions('business.expenses', item.id, item.status)}</td>
      <td class="row-actions"><button class="icon-btn" data-delete="business.expenses" data-id="${item.id}">✕</button></td>
    </tr>`;
  }

  function updateBusinessTotals() {
    const incomeM = DATA.business.income.reduce((s,i) => s + NextUpStore.toMonthly(i.amount, i.frequency), 0);
    const expM = DATA.business.expenses.reduce((s,e) => s + NextUpStore.toMonthly(e.amount, e.frequency), 0);
    const net = incomeM - expM;
    const weeklyTransfer = net < 0 ? (-net) / NextUpStore.WEEK_PER_MONTH : 0;
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    set('bizIncomeTotal', fmt(incomeM) + '/mo');
    set('bizExpenseTotal', fmt(expM) + '/mo');
    set('bizNet', fmt(net) + '/mo');
    set('bizWeeklyTransfer', fmt(weeklyTransfer) + '/wk');

    if (document.getElementById('pnlIncome')) {
      const pnl = NextUpStore.computeBusinessPnL(DATA, pnlPeriod, pnlCustomStart, pnlCustomEnd);
      set('pnlIncome', fmt(pnl.totalIncome));
      set('pnlExpense', fmt(pnl.totalExpense));
      const pnlNetEl = document.getElementById('pnlNet');
      if (pnlNetEl) {
        pnlNetEl.textContent = fmt(pnl.net);
        pnlNetEl.closest('.stat-card').classList.toggle('positive', pnl.net >= 0);
        pnlNetEl.closest('.stat-card').classList.toggle('negative', pnl.net < 0);
      }
      const catWrap = document.getElementById('pnlCategoryWrap');
      if (catWrap) catWrap.innerHTML = categoryBreakdownHtml(pnl.categoryTotals);
    }
  }

  // ================================================================
  // SAVINGS / INVESTING / RETIREMENT
  // ================================================================
  function renderSavings() {
    const root = document.getElementById('tab-savings');
    const totals = NextUpStore.computeSavingsTotals(DATA.savings);
    root.innerHTML = `
      <div class="stat-grid stat-grid-3">
        <div class="stat-card"><div class="lbl">Total Monthly Contributions</div><div class="val" id="savTotalMonthly">${fmt(totals.monthly)}/mo</div></div>
        <div class="stat-card negative"><div class="lbl">Counted as a household expense</div><div class="val" id="savExpenseMonthly">${fmt(totals.expenseMonthly)}/mo</div></div>
        <div class="stat-card positive"><div class="lbl">Just moving money (not an expense)</div><div class="val" id="savTransferMonthly">${fmt(totals.transferMonthly)}/mo</div></div>
      </div>
      <div class="card">
        <div class="card-head"><h3>Savings, Investing &amp; Retirement</h3><span class="sub">Track where money goes after it's earned</span></div>
        <p style="font-size:12.5px;color:var(--text-muted);margin:-6px 0 12px;">
          Mark each one <strong>Expense</strong> if it should count against your household budget, or <strong>Transfer</strong> if it's already-earned money you're simply moving somewhere else (like into a savings account you still have) — transfers don't reduce your margin.
        </p>
        <div class="table-wrap"><table class="table">
          <thead><tr><th>Name</th><th>Category</th><th>Counts as</th><th>Amount</th><th>Schedule</th><th>Notes</th><th></th></tr></thead>
          <tbody>${DATA.savings.map(s => savingsRow(s)).join('')}</tbody>
        </table></div>
        <div class="inline-form" id="addSavingsForm">
          <div class="field grow-2"><label>Name</label><input class="field-input" id="newSavName" placeholder="e.g. 401k, Roth IRA, Emergency fund"></div>
          <div class="field"><label>Category</label>
            <select class="field-input" id="newSavCategory"><option value="savings">Savings</option><option value="investing">Investing</option><option value="retirement">Retirement</option><option value="other">Other</option></select>
          </div>
          <div class="field"><label>Counts as</label>
            <select class="field-input" id="newSavKind"><option value="transfer">Transfer</option><option value="expense">Expense</option></select>
          </div>
          <div class="field"><label>Amount</label><input class="field-input" type="number" step="0.01" id="newSavAmount" placeholder="0.00"></div>
          <div class="field"><label>Frequency</label>
            <select class="field-input" id="newSavFreq"><option value="weekly">Weekly</option><option value="biweekly">Biweekly</option><option value="monthly">Monthly</option></select>
          </div>
          <button class="btn btn-primary" id="addSavingsBtn">+ Add</button>
        </div>
      </div>
    `;
    document.getElementById('addSavingsBtn').addEventListener('click', () => {
      const name = document.getElementById('newSavName').value.trim();
      const amount = parseFloat(document.getElementById('newSavAmount').value) || 0;
      if (!name) { toast('Give it a name first'); return; }
      DATA.savings.push({
        id: NextUpStore.uid('sav'), name,
        category: document.getElementById('newSavCategory').value,
        kind: document.getElementById('newSavKind').value,
        amount, frequency: document.getElementById('newSavFreq').value,
        weekday: 5, dueDay: 1, notes: ''
      });
      persist(); renderSavings(); toast('Added');
    });
  }

  function savingsRow(item) {
    return `<tr data-row-id="${item.id}">
      <td><input class="cell-input" data-kind="savings" data-id="${item.id}" data-field="name" value="${escapeHtml(item.name)}"></td>
      <td><select class="cell-input" data-kind="savings" data-id="${item.id}" data-field="category" data-refresh="tab">
        <option value="savings" ${item.category==='savings'?'selected':''}>Savings</option>
        <option value="investing" ${item.category==='investing'?'selected':''}>Investing</option>
        <option value="retirement" ${item.category==='retirement'?'selected':''}>Retirement</option>
        <option value="other" ${item.category==='other'?'selected':''}>Other</option>
      </select></td>
      <td><select class="cell-input" data-kind="savings" data-id="${item.id}" data-field="kind" data-refresh="tab">
        <option value="transfer" ${item.kind==='transfer'?'selected':''}>Transfer</option>
        <option value="expense" ${item.kind==='expense'?'selected':''}>Expense</option>
      </select></td>
      <td class="amt-cell"><input class="cell-input" type="number" step="0.01" data-kind="savings" data-id="${item.id}" data-field="amount" data-parse="number" data-live="savings" value="${item.amount}"></td>
      <td>${scheduleFieldsHTML('savings', item.id, item, [{v:'weekly',l:'Weekly'},{v:'biweekly',l:'Biweekly'},{v:'monthly',l:'Monthly'}])}</td>
      <td><input class="cell-input" data-kind="savings" data-id="${item.id}" data-field="notes" value="${escapeHtml(item.notes||'')}" placeholder="—"></td>
      <td class="row-actions"><button class="icon-btn" data-delete="savings" data-id="${item.id}">✕</button></td>
    </tr>`;
  }

  // ================================================================
  // ALL ITEMS
  // ================================================================
  function renderAllItems() {
    const root = document.getElementById('tab-all');
    const rows = [];
    DATA.income.forEach(i => rows.push({ name: i.name, kind: 'income', amount: i.amount, schedule: scheduleSummary(i), status: 'active', notes: i.notes }));
    DATA.bills.forEach(b => rows.push({ name: b.name, kind: 'bill', amount: b.amount, schedule: scheduleSummary(b), status: b.status, notes: b.notes }));
    DATA.debts.forEach(d => rows.push({ name: d.name, kind: 'debt', amount: (Number(d.minPayment)||0) + (Number(d.extraPayment)||0), schedule: scheduleSummary(d), status: d.status, notes: `Balance ${d.noBalance ? '—' : fmt(d.balance)}` }));
    DATA.business.income.forEach(i => rows.push({ name: i.name, kind: 'business-income', amount: i.amount, schedule: scheduleSummary(i), status: 'active', notes: i.notes }));
    DATA.business.expenses.forEach(e => rows.push({ name: e.name, kind: 'business-expense', amount: e.amount, schedule: scheduleSummary(e), status: e.status, notes: e.notes }));
    DATA.savings.forEach(s => rows.push({ name: s.name, kind: 'savings', amount: s.amount, schedule: scheduleSummary(s), status: 'active', notes: (s.kind === 'expense' ? 'Counts as expense' : 'Transfer') + (s.notes ? ' — ' + s.notes : '') }));

    root.innerHTML = `
      <div class="card">
        <div class="card-head">
          <h3>Everything, One List</h3>
          <div class="cal-filters" id="allFilters">
            ${['all','income','bill','debt','business-income','business-expense','savings'].map(k => `<label class="filter-chip"><input type="checkbox" data-k="${k}" ${k==='all'?'checked':''}>${k==='all'?'All':k.replace('-',' ')}</label>`).join('')}
          </div>
        </div>
        <div class="table-wrap"><table class="table">
          <thead><tr><th>Name</th><th>Type</th><th>Amount</th><th>Schedule</th><th>Status</th><th>Notes</th></tr></thead>
          <tbody id="allItemsBody">${rows.map(allItemRow).join('')}</tbody>
        </table></div>
      </div>
    `;
    const allBox = root.querySelector('[data-k="all"]');
    const boxes = Array.from(root.querySelectorAll('#allFilters input'));
    function applyFilter() {
      const activeKinds = boxes.filter(b => b.dataset.k !== 'all' && b.checked).map(b => b.dataset.k);
      document.querySelectorAll('#allItemsBody tr').forEach(tr => {
        tr.style.display = (activeKinds.length === 0 || activeKinds.includes(tr.dataset.kind)) ? '' : 'none';
      });
    }
    boxes.forEach(b => b.addEventListener('change', () => {
      if (b.dataset.k === 'all') { boxes.forEach(x => x.checked = b.checked); }
      else { allBox.checked = boxes.filter(x=>x.dataset.k!=='all').every(x=>x.checked); }
      applyFilter();
    }));
  }

  function allItemRow(r) {
    const pillClass = { income: 'pill-income', bill: 'pill-bill', debt: 'pill-debt', 'business-income': 'pill-income', 'business-expense': 'pill-business', savings: 'pill-business' }[r.kind];
    const sign = (r.kind === 'income' || r.kind === 'business-income') ? '+' : '-';
    return `<tr data-kind="${r.kind}">
      <td style="font-weight:600;">${escapeHtml(r.name)}</td>
      <td><span class="pill ${pillClass}">${r.kind.replace('-',' ')}</span></td>
      <td style="font-weight:700;color:${sign==='+'?'var(--income-green)':'var(--text)'}">${sign}${fmt(r.amount)}</td>
      <td style="color:var(--text-muted);font-size:13px;">${r.schedule}</td>
      <td>${statusPill(r.status)}</td>
      <td style="color:var(--text-muted);font-size:13px;">${escapeHtml(r.notes || '—')}</td>
    </tr>`;
  }

  // ================================================================
  // SETTINGS
  // ================================================================
  function creditScoreBand(score) {
    if (score == null) return { label: 'Not logged yet', color: 'var(--text-faint)' };
    if (score >= 800) return { label: 'Exceptional', color: 'var(--income-green)' };
    if (score >= 740) return { label: 'Very good', color: 'var(--income-green)' };
    if (score >= 670) return { label: 'Good', color: '#f2b705' };
    if (score >= 580) return { label: 'Fair', color: 'var(--business-orange)' };
    return { label: 'Poor', color: 'var(--debt-red)' };
  }

  const SMARTCREDIT_URL = 'https://www.smartcredit.com/join/?pid=60983';
  const CREDIT_BUREAU_COLORS = { experian: '#34e0a1', transunion: '#3b82f6', equifax: '#f2b705' };

  function renderProgress() {
    const root = document.getElementById('tab-progress');
    const bureaus = NextUpStore.CREDIT_BUREAUS;
    const labels = NextUpStore.CREDIT_BUREAU_LABELS;
    const cs = DATA.creditScore || { bureaus: {} };
    const snaps = (DATA.snapshots || []).slice(-12);
    const today = new Date().toISOString().slice(0, 10);

    const bureauBlocks = bureaus.map(b => {
      const rec = cs.bureaus[b] || { current: null, history: [] };
      const band = creditScoreBand(rec.current);
      return `
        <div class="meta-grid-col" style="flex:1;min-width:200px;padding:14px;border:1px solid var(--border);border-radius:12px;">
          <div style="font-size:12.5px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.03em;margin-bottom:6px;">${labels[b]}</div>
          <div style="font-size:32px;font-weight:800;color:${band.color};line-height:1;">${rec.current != null ? rec.current : '—'}</div>
          <div style="font-size:12px;color:var(--text-muted);margin:4px 0 12px;">${band.label}</div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;">
            <input type="number" class="csNewScore" data-bureau="${b}" min="300" max="900" placeholder="e.g. 712" style="width:90px;">
            <input type="date" class="csNewDate" data-bureau="${b}" value="${today}" style="width:130px;">
            <button class="btn btn-secondary csLogBtn" data-bureau="${b}">Log</button>
          </div>
        </div>`;
    }).join('');

    root.innerHTML = `
      <div class="card">
        <div class="card-head"><h3>Credit scores</h3><span class="sub">Log each bureau's score whenever you check it — see your trend over time.</span></div>
        <div style="display:flex;flex-wrap:wrap;gap:14px;margin-bottom:18px;">
          ${bureauBlocks}
        </div>
        <div style="height:180px;margin-bottom:18px;">
          <canvas id="creditScoreChart"></canvas>
        </div>
        <div style="padding-top:16px;border-top:1px solid var(--border);">
          <div style="font-size:12.5px;color:var(--text-muted);margin-bottom:8px;">Need to check your score? We partner with SmartCredit for monitoring &amp; reports.</div>
          <a class="btn btn-primary" href="${SMARTCREDIT_URL}" target="_blank" rel="noopener noreferrer sponsored">Check my score with SmartCredit &rarr;</a>
        </div>
      </div>

      <div class="card" style="margin-top:20px;">
        <div class="card-head"><h3>Financial trends</h3><span class="sub">Snapshotted automatically once a month.</span></div>
        ${snaps.length ? `<div style="height:220px;"><canvas id="trendChart"></canvas></div>` : `
          <div class="empty-state" style="padding:18px 0;">
            <div class="ic">${ICON_CHECK}</div>
            Your first monthly snapshot was just captured — check back next month to see a trend.
          </div>`}
      </div>
    `;

    root.querySelectorAll('.csLogBtn').forEach(btn => {
      btn.addEventListener('click', () => {
        const b = btn.dataset.bureau;
        const scoreEl = root.querySelector(`.csNewScore[data-bureau="${b}"]`);
        const dateEl = root.querySelector(`.csNewDate[data-bureau="${b}"]`);
        const valRaw = scoreEl.value;
        if (valRaw === '') { toast('Enter a score first'); return; }
        const num = parseInt(valRaw, 10);
        if (isNaN(num) || num < 300 || num > 900) { toast('Enter a score between 300 and 900'); return; }
        NextUpStore.addCreditScoreEntry(DATA, b, num, dateEl.value || undefined);
        persist();
        renderProgress();
        toast(`${labels[b]} score logged`);
      });
    });

    if (typeof Chart !== 'undefined') {
      const scoreCanvas = document.getElementById('creditScoreChart');
      if (scoreCanvas) {
        if (progressCharts.score) { progressCharts.score.destroy(); progressCharts.score = null; }
        const allDates = Array.from(new Set(bureaus.flatMap(b => (cs.bureaus[b].history || []).map(h => h.date)))).sort();
        progressCharts.score = new Chart(scoreCanvas, {
          type: 'line',
          data: {
            labels: allDates,
            datasets: bureaus.map(b => {
              const histByDate = {};
              (cs.bureaus[b].history || []).forEach(h => { histByDate[h.date] = h.score; });
              return {
                label: labels[b],
                data: allDates.map(d => histByDate[d] !== undefined ? histByDate[d] : null),
                borderColor: CREDIT_BUREAU_COLORS[b],
                backgroundColor: CREDIT_BUREAU_COLORS[b] + '20',
                spanGaps: true,
                tension: 0.3,
                pointRadius: 3
              };
            })
          },
          options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { position: 'bottom' } },
            scales: { y: { min: 300, max: 900 } }
          }
        });
      }
      const trendCanvas = document.getElementById('trendChart');
      if (trendCanvas) {
        if (progressCharts.trend) { progressCharts.trend.destroy(); progressCharts.trend = null; }
        progressCharts.trend = new Chart(trendCanvas, {
          type: 'line',
          data: {
            labels: snaps.map(s => s.period),
            datasets: [
              { label: 'Total debt', data: snaps.map(s => s.totalDebtBalance), borderColor: '#ef4444', backgroundColor: 'rgba(239,68,68,0.08)', tension: 0.3 },
              { label: 'Monthly margin', data: snaps.map(s => s.monthlyMargin), borderColor: '#34e0a1', backgroundColor: 'rgba(52,224,161,0.08)', tension: 0.3 }
            ]
          },
          options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { position: 'bottom' } }
          }
        });
      }
    }
  }

  function renderSettings() {
    const root = document.getElementById('tab-settings');
    const isSpecial = USER.isOwner || USER.plan === 'demo';

    root.innerHTML = `
      <div class="card">
        <div class="card-head"><h3>Account &amp; Billing</h3><span class="sub">${escapeHtml(planLabel(USER))}</span></div>
        ${isSpecial ? `
          <div class="empty-state" style="padding:18px 0;">
            <div class="ic">${ICON_CARD}</div>
            ${USER.isOwner ? 'Owner account — billing controls don’t apply here.' : 'Demo account — no billing on this account.'}
          </div>
        ` : `
          <p style="font-size:13.5px;color:var(--text-muted);margin:0 0 14px;">
            Manage your account, cancel your subscription, view payment history, or change your card — all handled securely inside Stripe's billing portal.
          </p>
          <button class="btn btn-secondary" id="settingsBillingBtn"><span class="ic">${ICON_CARD}</span> Manage account &amp; billing</button>
        `}
      </div>
    `;

    if (!isSpecial) {
      const btn = document.getElementById('settingsBillingBtn');
      const original = btn.innerHTML;
      btn.addEventListener('click', async () => {
        btn.innerHTML = '<span class="ic">' + ICON_CARD + '</span> Loading…';
        try {
          const { data, error } = await supabaseClient.functions.invoke('create-billing-portal-session', {
            body: { returnUrl: window.location.href }
          });
          if (error || !data || !data.url) throw new Error((data && data.error) || (error && error.message) || 'Could not open billing portal.');
          window.location.href = data.url;
        } catch (err) {
          btn.innerHTML = original;
          toast(err.message);
        }
      });
    }
  }

  // ================================================================
  // FEEDBACK
  // ================================================================
  let feedbackRating = 0;

  function renderFeedback() {
    const root = document.getElementById('tab-feedback');
    feedbackRating = 0;
    root.innerHTML = `
      <div class="card" style="max-width:560px;">
        <div class="card-head"><h3>Send feedback</h3><span class="sub">Bugs, ideas, confusing bits — anything. It comes straight to us.</span></div>
        <div class="meta-grid" style="margin-bottom:12px;">
          <label>Your name <span style="color:var(--text-faint);font-weight:400;">(optional)</span>
            <input type="text" id="fbName" placeholder="Jordan Smith">
          </label>
          <label>Email <span style="color:var(--text-faint);font-weight:400;">(optional, if you want a reply)</span>
            <input type="email" id="fbEmail" placeholder="you@example.com">
          </label>
        </div>
        <label style="display:block;font-size:12.5px;font-weight:600;color:var(--text-muted);margin-bottom:6px;">How's it feel so far?</label>
        <div class="feedback-stars" id="fbStars">
          ${[1,2,3,4,5].map(n => `<button type="button" data-star="${n}" aria-label="${n} star">&#9733;</button>`).join('')}
        </div>
        <label style="display:block;margin-top:12px;">
          <span style="font-size:12.5px;font-weight:600;color:var(--text-muted);">Message</span>
          <textarea id="fbMessage" rows="5" placeholder="What worked, what didn't, what you'd want to see..." style="width:100%;margin-top:6px;padding:10px 12px;border:1px solid var(--border-strong);border-radius:8px;font-family:inherit;font-size:14px;resize:vertical;"></textarea>
        </label>
        <button class="btn btn-primary" id="fbSubmit" style="margin-top:14px;">Send feedback</button>
        <div id="fbStatus" style="margin-top:10px;font-size:13px;color:var(--income-green);display:none;">Thanks — your feedback was sent!</div>
      </div>
    `;

    root.querySelectorAll('#fbStars button').forEach(btn => {
      btn.addEventListener('click', () => {
        feedbackRating = parseInt(btn.dataset.star, 10);
        root.querySelectorAll('#fbStars button').forEach(b => b.classList.toggle('selected', parseInt(b.dataset.star, 10) <= feedbackRating));
      });
    });

    document.getElementById('fbSubmit').addEventListener('click', async () => {
      const btn = document.getElementById('fbSubmit');
      const message = document.getElementById('fbMessage').value.trim();
      if (!message) { toast('Add a message first'); return; }
      const name = document.getElementById('fbName').value.trim();
      const email = document.getElementById('fbEmail').value.trim();
      btn.disabled = true;
      btn.textContent = 'Sending…';
      try {
        const { error } = await supabaseClient.from('feedback').insert({
          name: name || null,
          email: email || null,
          message,
          rating: feedbackRating || null,
          source: (window.NEXTUP_DEMO_MODE ? 'demo' : 'app'),
          page: activeTab,
          user_agent: navigator.userAgent
        });
        if (error) throw error;
        document.getElementById('fbStatus').style.display = 'block';
        document.getElementById('fbMessage').value = '';
        toast('Feedback sent — thank you!');
      } catch (err) {
        toast('Could not send feedback — try again in a moment.');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Send feedback';
      }
    });
  }

  // ================================================================
  // GLOBAL EDIT DELEGATION
  // ================================================================
  function applyEdit(el) {
    const { kind, id, field, parse } = el.dataset;
    const item = findItem(kind, id);
    if (!item) return;
    let val;
    if (parse === 'bool') {
      val = el.checked;
    } else {
      val = el.value;
      if (parse === 'number') val = val === '' ? 0 : parseFloat(val);
      else if (parse === 'int') val = val === '' ? null : parseInt(val, 10);
    }
    item[field] = val;
    if (kind === 'income') maybeRecomputeIncomeAmount(item);
    persist();
  }

  function maybeRecomputeIncomeAmount(item) {
    if (item && item.type === 'w2' && item.payStructure && item.payStructure !== 'none') {
      item.amount = NextUpStore.computeNetPayAmount(item);
    }
  }

  function updateIncomePayComputed(id) {
    const item = findItem('income', id);
    if (!item) return;
    const amtInput = document.querySelector(`input[data-kind="income"][data-id="${id}"][data-field="amount"]`);
    if (amtInput) amtInput.value = Number(item.amount).toFixed(2);
    const totalM = DATA.income.reduce((s, i) => s + NextUpStore.toMonthly(i.amount, i.frequency), 0);
    const tm = document.getElementById('incomeTotalMonthly'); if (tm) tm.textContent = fmt(totalM) + '/mo';
    const tw = document.getElementById('incomeTotalWeekly'); if (tw) tw.textContent = fmt(totalM / NextUpStore.WEEK_PER_MONTH) + '/wk';
    const netDisplay = document.querySelector(`.incomepay-net[data-id="${id}"]`);
    if (netDisplay) netDisplay.innerHTML = `Estimated net pay: <strong style="color:var(--income-green);">${NextUpStore.fmtMoney(item.amount)}</strong> / ${item.frequency} (this is an estimate — check your actual pay stub for exact withholding)`;
  }

  function bindGlobalDelegation() {
    document.addEventListener('input', (e) => {
      const el = e.target;
      if (!el.matches('[data-field]') || el.tagName === 'SELECT') return;
      applyEdit(el);
      if (el.dataset.live === 'debt') {
        updateDebtCardComputed(el.dataset.id);
      } else if (el.dataset.live === 'bills') {
        const totalM = DATA.bills.reduce((s, b) => s + NextUpStore.toMonthly(b.amount, b.frequency), 0);
        const tm = document.getElementById('billsTotalMonthly'); if (tm) tm.textContent = fmt(totalM) + '/mo';
        const tw = document.getElementById('billsTotalWeekly'); if (tw) tw.textContent = fmt(totalM / NextUpStore.WEEK_PER_MONTH) + '/wk';
      } else if (el.dataset.live === 'income') {
        const totalM = DATA.income.reduce((s, i) => s + NextUpStore.toMonthly(i.amount, i.frequency), 0);
        const tm = document.getElementById('incomeTotalMonthly'); if (tm) tm.textContent = fmt(totalM) + '/mo';
        const tw = document.getElementById('incomeTotalWeekly'); if (tw) tw.textContent = fmt(totalM / NextUpStore.WEEK_PER_MONTH) + '/wk';
      } else if (el.dataset.live === 'business') {
        updateBusinessTotals();
      } else if (el.dataset.live === 'incomepay') {
        updateIncomePayComputed(el.dataset.id);
      } else if (el.dataset.live === 'savings') {
        const t = NextUpStore.computeSavingsTotals(DATA.savings);
        const tm = document.getElementById('savTotalMonthly'); if (tm) tm.textContent = fmt(t.monthly) + '/mo';
        const te = document.getElementById('savExpenseMonthly'); if (te) te.textContent = fmt(t.expenseMonthly) + '/mo';
        const tt = document.getElementById('savTransferMonthly'); if (tt) tt.textContent = fmt(t.transferMonthly) + '/mo';
      }
    });

    document.addEventListener('change', (e) => {
      const el = e.target;
      if (!el.matches('[data-field]')) return;
      applyEdit(el);
      if (el.dataset.refresh === 'tab') {
        if (activeTab === 'income') renderIncome();
        else if (activeTab === 'bills') renderBills();
        else if (activeTab === 'debts') renderDebts();
        else if (activeTab === 'business') renderBusiness();
        else if (activeTab === 'savings') renderSavings();
      } else if (el.dataset.kind === 'debts') {
        updateDebtCardComputed(el.dataset.id);
      } else if (String(el.dataset.kind).startsWith('business')) {
        updateBusinessTotals();
      }
    });

    document.addEventListener('click', (e) => {
      const payToggle = e.target.closest('.income-pay-toggle');
      if (payToggle) {
        const id = payToggle.dataset.id;
        if (incomePayOpenIds.has(id)) incomePayOpenIds.delete(id);
        else incomePayOpenIds.add(id);
        renderIncome();
        return;
      }
      const del = e.target.closest('[data-delete]');
      if (!del) return;
      const kind = del.dataset.delete, id = del.dataset.id;
      const arr = getArray(kind);
      const idx = arr.findIndex(x => x.id === id);
      if (idx === -1) return;
      if (!confirm(`Delete "${arr[idx].name}"?`)) return;
      arr.splice(idx, 1);
      persist();
      if (kind === 'income') renderIncome();
      else if (kind === 'bills') renderBills();
      else if (kind === 'debts') renderDebts();
      else if (kind === 'business.income' || kind === 'business.expenses' || kind === 'business.transactions') renderBusiness();
      else if (kind === 'savings') renderSavings();
      toast('Deleted');
    });
  }

  return { init };
})();
