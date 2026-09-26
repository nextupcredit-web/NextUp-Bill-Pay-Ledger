/* ============================================================
   NextUp Bill Pay Ledger — Interactive Calendar
   Renders a month grid of bills, debts, business items, and
   income, colored by category, with month-to-month toggling
   and a click-through day detail panel.
   ============================================================ */

const NextUpCalendar = (() => {
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

  let state = {
    year: new Date().getFullYear(),
    month: new Date().getMonth(),
    filters: { bill: true, debt: true, 'business-income': true, 'business-expense': true, income: true },
    getData: null,
    root: null
  };

  function kindLabel(kind) {
    return { bill: 'Bill', debt: 'Debt', income: 'Income', 'business-income': 'Business income', 'business-expense': 'Business' }[kind] || kind;
  }

  function fmtCompact(n) {
    const num = Number(n) || 0;
    const sign = num < 0 ? '-' : '+';
    const abs = Math.abs(num);
    const rounded = abs >= 1000 ? Math.round(abs / 100) / 10 + 'k' : Math.round(abs);
    return sign + '$' + rounded;
  }

  function mount(root, getData) {
    state.root = root;
    state.getData = getData;
    root.innerHTML = `
      <div class="cal-toolbar">
        <div class="cal-nav">
          <button class="icon-btn" id="calPrev" style="width:34px;height:34px;">&larr;</button>
          <div class="month-label" id="calLabel"></div>
          <button class="icon-btn" id="calNext" style="width:34px;height:34px;">&rarr;</button>
          <button class="btn btn-ghost btn-sm" id="calToday">Today</button>
        </div>
        <div class="cal-filters" id="calFilters">
          ${chip('bill', 'Bills', 'var(--bill-blue)')}
          ${chip('debt', 'Debts', 'var(--debt-red)')}
          ${chip('business-expense', 'Business exp.', 'var(--business-orange)')}
          ${chip('income', 'Income', 'var(--income-green)')}
          ${chip('business-income', 'Business income', 'var(--income-green)')}
        </div>
      </div>
      <div class="cal-grid" id="calDow">
        ${DOW.map(d => `<div class="cal-dow">${d}</div>`).join('')}
      </div>
      <div class="cal-grid" id="calCells" style="margin-top:6px;"></div>
      <div class="card" style="margin-top:18px;">
        <div class="card-head"><h3>This month at a glance</h3></div>
        <div class="stat-grid" id="calMonthStats" style="margin-bottom:0;"></div>
      </div>
    `;
    root.querySelector('#calPrev').addEventListener('click', () => shift(-1));
    root.querySelector('#calNext').addEventListener('click', () => shift(1));
    root.querySelector('#calToday').addEventListener('click', () => {
      const now = new Date();
      state.year = now.getFullYear(); state.month = now.getMonth();
      render();
    });
    root.querySelectorAll('#calFilters input[type=checkbox]').forEach(cb => {
      cb.addEventListener('change', () => { state.filters[cb.dataset.kind] = cb.checked; render(); });
    });
    render();
  }

  function chip(kind, label, color) {
    return `<label class="filter-chip"><input type="checkbox" data-kind="${kind}" checked><span class="dot" style="background:${color}"></span>${label}</label>`;
  }

  function shift(delta) {
    state.month += delta;
    if (state.month < 0) { state.month = 11; state.year--; }
    if (state.month > 11) { state.month = 0; state.year++; }
    render();
  }

  function refresh() { render(); }

  function render() {
    const root = state.root;
    if (!root) return;
    const data = state.getData();
    root.querySelector('#calLabel').textContent = `${MONTHS[state.month]} ${state.year}`;

    const events = NextUpStore.buildCalendarEvents(data, state.year, state.month)
      .filter(e => state.filters[e.kind]);

    const byDay = {};
    events.forEach(e => {
      const key = e.date.getDate();
      (byDay[key] = byDay[key] || []).push(e);
    });

    const dim = NextUpStore.daysInMonth(state.year, state.month);
    const firstDow = new Date(state.year, state.month, 1).getDay();
    const today = new Date();
    const isCurrentMonth = today.getFullYear() === state.year && today.getMonth() === state.month;

    let html = '';
    for (let i = 0; i < firstDow; i++) html += `<div class="cal-cell empty"></div>`;
    for (let day = 1; day <= dim; day++) {
      const dayEvents = (byDay[day] || []).slice().sort((a,b) => a.sign - b.sign);
      const total = dayEvents.reduce((s, e) => s + e.sign * e.amount, 0);
      const shown = dayEvents.slice(0, 3);
      const extra = dayEvents.length - shown.length;
      const isToday = isCurrentMonth && today.getDate() === day;
      html += `
        <div class="cal-cell${isToday ? ' today' : ''}" data-day="${day}">
          <div class="cal-date">${day}</div>
          <div class="cal-chips">
            ${shown.map(e => `<div class="cal-chip ${e.kind}">${e.sign > 0 ? '+' : ''}${NextUpStore.fmtMoney(e.amount)} ${escapeHtml(e.name)}</div>`).join('')}
            ${extra > 0 ? `<div class="cal-more">+${extra} more</div>` : ''}
          </div>
          ${dayEvents.length ? `<div class="cal-day-total">Net ${total >= 0 ? '+' : ''}${NextUpStore.fmtMoney(total)}</div>` : ''}
          ${dayEvents.length ? `<div class="cal-day-net ${total >= 0 ? 'pos' : 'neg'}">${fmtCompact(total)}</div>` : ''}
          ${dayEvents.length > 1 ? `<div class="cal-day-dots">${dayEvents.slice(0, 4).map(e => `<span class="cal-dot-mini ${e.kind}"></span>`).join('')}</div>` : ''}
        </div>`;
    }
    root.querySelector('#calCells').innerHTML = html;
    root.querySelectorAll('.cal-cell[data-day]').forEach(cell => {
      cell.addEventListener('click', () => openDay(parseInt(cell.dataset.day, 10), byDay[parseInt(cell.dataset.day, 10)] || []));
    });

    // month stats
    const income = events.filter(e => e.sign > 0).reduce((s,e) => s + e.amount, 0);
    const outflow = events.filter(e => e.sign < 0).reduce((s,e) => s + e.amount, 0);
    const statHtml = `
      <div class="stat-card"><div class="lbl">Events shown</div><div class="val">${events.length}</div></div>
      <div class="stat-card positive"><div class="lbl">Income this month</div><div class="val">${NextUpStore.fmtMoney(income)}</div></div>
      <div class="stat-card negative"><div class="lbl">Outflow this month</div><div class="val">${NextUpStore.fmtMoney(outflow)}</div></div>
      <div class="stat-card ${income - outflow >= 0 ? 'positive' : 'negative'}"><div class="lbl">Net this month</div><div class="val">${NextUpStore.fmtMoney(income - outflow)}</div></div>
    `;
    root.querySelector('#calMonthStats').innerHTML = statHtml;
  }

  function openDay(day, events) {
    const modal = document.getElementById('dayModalOverlay');
    const dateStr = `${MONTHS[state.month]} ${day}, ${state.year}`;
    document.getElementById('dayModalTitle').textContent = dateStr;
    const total = events.reduce((s,e) => s + e.sign * e.amount, 0);
    const body = document.getElementById('dayModalBody');
    if (!events.length) {
      body.innerHTML = `<div class="empty-state"><div class="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M8 3v4M16 3v4M3.5 10h17"/></svg></div>Nothing scheduled this day.</div>`;
    } else {
      body.innerHTML = events.map(e => `
        <div class="modal-item ${e.kind}">
          <div>
            <div class="name">${escapeHtml(e.name)}</div>
            <div style="font-size:11.5px;color:var(--text-faint);margin-top:2px;">${kindLabel(e.kind)}</div>
          </div>
          <div class="amt">${e.sign > 0 ? '+' : '-'}${NextUpStore.fmtMoney(e.amount)}</div>
        </div>
      `).join('') + `<div class="modal-total"><span>Net for the day</span><span style="color:${total>=0?'var(--income-green)':'var(--debt-red)'}">${total>=0?'+':''}${NextUpStore.fmtMoney(total)}</span></div>`;
    }
    modal.classList.add('show');
  }

  function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str == null ? '' : String(str);
    return d.innerHTML;
  }

  return { mount, refresh };
})();
