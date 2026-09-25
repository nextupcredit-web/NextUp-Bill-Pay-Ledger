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

  const WEEKDAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const WD_SHORT = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const NTH_LABEL = { 1: '1st', 2: '2nd', 3: '3rd', 4: '4th' };
  const ICON_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.5 2.5L16 9.5"/></svg>';

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
    return DATA[kind];
  }
  function findItem(kind, id) { return (getArray(kind) || []).find(x => x.id === id); }

  // ---------- init ----------
  async function init(user) {
    USER = user;
    DATA = await NextUpStore.ensureData(user.id, user.isOwner);

    document.querySelectorAll('.user-name-display').forEach(el => el.textContent = user.name || user.email);
    document.querySelectorAll('.user-plan-display').forEach(el => el.textContent = planLabel(user));
    document.querySelectorAll('.avatar-display').forEach(el => el.textContent = (user.name || user.email || '?').trim().charAt(0).toUpperCase());

    document.querySelectorAll('.side-link[data-tab]').forEach(link => {
      link.addEventListener('click', (e) => { e.preventDefault(); switchTab(link.dataset.tab); });
    });
    document.querySelectorAll('.logout-trigger').forEach(btn => btn.addEventListener('click', (e) => {
      e.preventDefault();
      NextUpAuth.logOut();
      window.location.href = 'index.html';
    }));

    const billingBtn = document.getElementById('billingTrigger');
    if (billingBtn) {
      if (user.isOwner || user.plan === 'demo') {
        billingBtn.style.display = 'none';
      } else {
        billingBtn.addEventListener('click', async (e) => {
          e.preventDefault();
          const original = billingBtn.innerHTML;
          billingBtn.innerHTML = '<span class="ic">&#128179;</span> Loading…';
          try {
            const { data, error } = await supabaseClient.functions.invoke('create-billing-portal-session', {
              body: { returnUrl: window.location.href }
            });
            if (error || !data || !data.url) throw new Error((data && data.error) || (error && error.message) || 'Could not open billing portal.');
            window.location.href = data.url;
          } catch (err) {
            billingBtn.innerHTML = original;
            toast(err.message);
          }
        });
      }
    }

    bindGlobalDelegation();
    NextUpCalendar.mount(document.getElementById('calRoot'), () => DATA);
    document.getElementById('dayModalClose').addEventListener('click', closeDayModal);
    document.getElementById('dayModalOverlay').addEventListener('click', (e) => { if (e.target.id === 'dayModalOverlay') closeDayModal(); });

    switchTab('overview');
  }

  function closeDayModal() { document.getElementById('dayModalOverlay').classList.remove('show'); }

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
      calendar: ['Calendar', 'Every bill, debt, and payday on the dates they land.'],
      all: ['All Items', 'One list of everything across your whole ledger.']
    };
    const [h, sub] = titles[tab] || ['', ''];
    document.getElementById('mainTitle').textContent = h;
    document.getElementById('mainSub').textContent = sub;

    if (tab === 'overview') renderOverview();
    else if (tab === 'income') renderIncome();
    else if (tab === 'bills') renderBills();
    else if (tab === 'debts') renderDebts();
    else if (tab === 'business') renderBusiness();
    else if (tab === 'calendar') NextUpCalendar.refresh();
    else if (tab === 'all') renderAllItems();
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
      </div>

      <div class="panel-grid">
        <div>
          <div class="card">
            <div class="card-head"><h3>Recommended Bills Transfer</h3><span class="sub">Auto-calculated — override it anytime</span></div>
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
              <label>Frequency for your transfer</label>
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
            <table class="table">
              <tbody>
                <tr><td><span class="pill pill-bill">Bills</span></td><td style="text-align:right;">${fmt(s.billsMonthly)}/mo</td></tr>
                <tr><td><span class="pill pill-debt">Debt payments</span></td><td style="text-align:right;">${fmt(s.debtsMonthly)}/mo</td></tr>
                <tr><td><span class="pill pill-business">Business expenses</span></td><td style="text-align:right;">${fmt(s.businessExpMonthly)}/mo</td></tr>
                <tr><td><span class="pill pill-income">Business income</span></td><td style="text-align:right;">${fmt(s.businessIncomeMonthly)}/mo</td></tr>
                <tr><td>Business net position</td><td style="text-align:right;font-weight:700;color:${s.businessNet>=0?'var(--income-green)':'var(--debt-red)'}">${fmt(s.businessNet)}/mo</td></tr>
              </tbody>
            </table>
          </div>

          <div class="card">
            <div class="card-head"><h3>Your data</h3><span class="sub">Stored locally in this browser</span></div>
            <div style="display:flex;gap:10px;flex-wrap:wrap;">
              <button class="btn btn-secondary btn-sm" id="btnExport">Export JSON</button>
              <button class="btn btn-secondary btn-sm" id="btnImport">Import JSON</button>
              <input type="file" id="fileImport" accept="application/json" style="display:none;">
              <button class="btn btn-secondary btn-sm" id="btnResetSeed">Reset to sample data</button>
              <button class="btn btn-danger btn-sm" id="btnClearAll">Clear all data</button>
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
    return `<tr data-row-id="${item.id}">
      <td><input class="cell-input" data-kind="income" data-id="${item.id}" data-field="name" value="${escapeHtml(item.name)}"></td>
      <td><select class="cell-input" data-kind="income" data-id="${item.id}" data-field="type" data-refresh="tab">
        <option value="w2" ${item.type==='w2'?'selected':''}>W2</option>
        <option value="self-employed" ${item.type==='self-employed'?'selected':''}>Self-employed</option>
        <option value="other" ${item.type==='other'?'selected':''}>Other</option>
      </select></td>
      <td class="amt-cell"><input class="cell-input" type="number" step="0.01" data-kind="income" data-id="${item.id}" data-field="amount" data-parse="number" data-live="income" value="${item.amount}"></td>
      <td>${scheduleFieldsHTML('income', item.id, item, [{v:'weekly',l:'Weekly'},{v:'biweekly',l:'Biweekly'},{v:'monthly',l:'Monthly'}])}</td>
      <td><input class="cell-input" data-kind="income" data-id="${item.id}" data-field="notes" value="${escapeHtml(item.notes||'')}" placeholder="—"></td>
      <td class="row-actions"><button class="icon-btn" data-delete="income" data-id="${item.id}">✕</button></td>
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
        <div class="debt-card-top">
          <div class="debt-name-row">
            ${rank ? `<div class="debt-rank">${rank}</div>` : ''}
            <div>
              <input class="cell-input" style="font-size:15.5px;font-weight:700;padding:2px 4px;" data-kind="debts" data-id="${d.id}" data-field="name" value="${escapeHtml(d.name)}">
              <div><span class="pill pill-debt">${catLabel(d.debtCategory)}</span> ${d.pastDue ? `<span class="pill" style="background:#fdeaea;color:#b42318;">Past due ${fmt(d.pastDue)}</span>` : ''}</div>
            </div>
          </div>
          <div style="text-align:right;">
            ${d.noBalance ? `<div style="font-size:13px;color:var(--text-faint);">No fixed balance</div>` :
              `<div class="debt-balance" id="balDisplay_${d.id}">${fmt(d.balance)}</div>`}
            <div class="row-actions" style="margin-top:4px;"><button class="icon-btn" data-delete="debts" data-id="${d.id}">✕</button></div>
          </div>
        </div>

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

    root.innerHTML = `
      <div class="stat-grid">
        <div class="stat-card positive"><div class="lbl">Business Income</div><div class="val" id="bizIncomeTotal">${fmt(incomeM)}/mo</div></div>
        <div class="stat-card"><div class="lbl">Business Expenses</div><div class="val" id="bizExpenseTotal">${fmt(expM)}/mo</div></div>
        <div class="stat-card ${net>=0?'positive':'negative'}"><div class="lbl">Net Position</div><div class="val" id="bizNet">${fmt(net)}/mo</div></div>
        <div class="stat-card accent"><div class="lbl">Weekly Transfer Needed</div><div class="val" id="bizWeeklyTransfer">${fmt(weeklyTransfer)}/wk</div><div class="note">From personal, to cover the gap</div></div>
      </div>

      <div class="card">
        <div class="card-head"><h3>Business Income</h3><span class="sub">NextUp Enterprise clients & transfers in</span></div>
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
        <div class="card-head"><h3>Business Expenses</h3><span class="sub">Software, office, tools</span></div>
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

    root.innerHTML = `
      <div class="card">
        <div class="card-head">
          <h3>Everything, One List</h3>
          <div class="cal-filters" id="allFilters">
            ${['all','income','bill','debt','business-income','business-expense'].map(k => `<label class="filter-chip"><input type="checkbox" data-k="${k}" ${k==='all'?'checked':''}>${k==='all'?'All':k.replace('-',' ')}</label>`).join('')}
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
    const pillClass = { income: 'pill-income', bill: 'pill-bill', debt: 'pill-debt', 'business-income': 'pill-income', 'business-expense': 'pill-business' }[r.kind];
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
  // GLOBAL EDIT DELEGATION
  // ================================================================
  function applyEdit(el) {
    const { kind, id, field, parse } = el.dataset;
    const item = findItem(kind, id);
    if (!item) return;
    let val = el.value;
    if (parse === 'number') val = val === '' ? 0 : parseFloat(val);
    else if (parse === 'int') val = val === '' ? null : parseInt(val, 10);
    item[field] = val;
    persist();
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
      } else if (el.dataset.kind === 'debts') {
        updateDebtCardComputed(el.dataset.id);
      } else if (String(el.dataset.kind).startsWith('business')) {
        updateBusinessTotals();
      }
    });

    document.addEventListener('click', (e) => {
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
      else if (kind === 'business.income' || kind === 'business.expenses') renderBusiness();
      toast('Deleted');
    });
  }

  return { init };
})();
