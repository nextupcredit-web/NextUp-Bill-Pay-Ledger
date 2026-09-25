/* ============================================================
   NextUp Bill Pay Ledger — Data Store & Calculation Engine
   Ledger data lives in Supabase (table `ledger_data`, one row
   per user, RLS-scoped to auth.uid()) — see supabase/schema.sql.
   This file owns the schema, persistence, and every real-time
   calculation (monthly/weekly totals, margins, debt snowball,
   payoff dates).
   ============================================================ */

const NextUpStore = (() => {
  const WEEK_PER_MONTH = 52 / 12;      // 4.33333
  const BIWEEK_PER_MONTH = 26 / 12;    // 2.16667

  function uid(prefix) {
    const rand = (crypto && crypto.randomUUID) ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
    return `${prefix}_${rand}`;
  }

  function defaultData() {
    return {
      meta: { version: 1, createdAt: new Date().toISOString() },
      settings: {
        weeklyBuffer: 100,
        customTransferAmount: null,      // null => use recommended
        customTransferFrequency: 'weekly', // weekly | biweekly | monthly
        snowballExtra: 0                  // extra $/mo user throws at debt snowball
      },
      income: [],
      bills: [],
      debts: [],
      business: { income: [], expenses: [] }
    };
  }

  // ---------- persistence ----------
  async function load(userId) {
    if (!userId) return null;
    const { data, error } = await supabaseClient.from('ledger_data').select('data').eq('user_id', userId).single();
    if (error || !data) return null;
    return data.data;
  }

  async function save(userId, data) {
    await supabaseClient.from('ledger_data').upsert({ user_id: userId, data, updated_at: new Date().toISOString() });
  }

  function buildSeed(isOwner) {
    if (typeof NextUpSeed === 'undefined') return defaultData();
    return isOwner ? NextUpSeed.buildOwner() : NextUpSeed.buildDemo();
  }

  async function ensureData(userId, isOwner) {
    let data = await load(userId);
    if (!data) {
      data = buildSeed(isOwner);
      await save(userId, data);
    }
    // backfill any fields added after a user's data was first created
    const def = defaultData();
    data.settings = Object.assign({}, def.settings, data.settings || {});
    data.business = data.business || { income: [], expenses: [] };
    data.business.income = data.business.income || [];
    data.business.expenses = data.business.expenses || [];
    data.income = data.income || [];
    data.bills = data.bills || [];
    data.debts = data.debts || [];
    return data;
  }

  async function resetToSeed(userId, isOwner) {
    const data = buildSeed(isOwner);
    await save(userId, data);
    return data;
  }

  async function wipe(userId) {
    const data = defaultData();
    await save(userId, data);
    return data;
  }

  // ---------- frequency normalization ----------
  function toMonthly(amount, frequency) {
    amount = Number(amount) || 0;
    switch (frequency) {
      case 'weekly': return amount * WEEK_PER_MONTH;
      case 'biweekly': return amount * BIWEEK_PER_MONTH;
      case 'semimonthly': return amount * 2;
      case 'monthly':
      case 'monthly-nth-weekday': return amount;
      case 'onetime': return 0;
      default: return amount;
    }
  }

  function toWeekly(amount, frequency) {
    if (frequency === 'onetime') return 0;
    return toMonthly(amount, frequency) / WEEK_PER_MONTH;
  }

  function toBiweekly(amount, frequency) {
    if (frequency === 'onetime') return 0;
    return toMonthly(amount, frequency) / BIWEEK_PER_MONTH;
  }

  function fmtMoney(n) {
    const num = Number(n) || 0;
    const sign = num < 0 ? '-' : '';
    return sign + '$' + Math.abs(num).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  // ---------- summary / totals ----------
  function debtMonthlyPayment(debt) {
    const total = (Number(debt.minPayment) || 0) + (Number(debt.extraPayment) || 0);
    return toMonthly(total, debt.frequency || 'monthly');
  }

  function computeSummary(data) {
    const personalIncomeMonthly = data.income.reduce((s, i) => s + toMonthly(i.amount, i.frequency), 0);
    const businessIncomeMonthly = data.business.income.reduce((s, i) => s + toMonthly(i.amount, i.frequency), 0);
    const totalIncomeMonthly = personalIncomeMonthly + businessIncomeMonthly;

    const billsMonthly = data.bills.reduce((s, b) => s + toMonthly(b.amount, b.frequency), 0);
    const debtsMonthly = data.debts
      .filter(d => d.status !== 'paused')
      .reduce((s, d) => s + debtMonthlyPayment(d), 0);
    const businessExpMonthly = data.business.expenses.reduce((s, e) => s + toMonthly(e.amount, e.frequency), 0);
    const totalExpensesMonthly = billsMonthly + debtsMonthly + businessExpMonthly;

    const monthlyMargin = totalIncomeMonthly - totalExpensesMonthly;
    const weeklyIncome = totalIncomeMonthly / WEEK_PER_MONTH;
    const weeklyExpenses = totalExpensesMonthly / WEEK_PER_MONTH;
    const weeklyMargin = weeklyIncome - weeklyExpenses;

    const businessNet = businessIncomeMonthly - businessExpMonthly;

    const buffer = Number(data.settings.weeklyBuffer) || 0;
    const recommendedMonthlyTransfer = totalExpensesMonthly + buffer * WEEK_PER_MONTH;
    const recommendedWeeklyTransfer = recommendedMonthlyTransfer / WEEK_PER_MONTH;
    const recommendedBiweeklyTransfer = recommendedMonthlyTransfer / BIWEEK_PER_MONTH;

    return {
      personalIncomeMonthly, businessIncomeMonthly, totalIncomeMonthly,
      billsMonthly, debtsMonthly, businessExpMonthly, totalExpensesMonthly,
      monthlyMargin, weeklyIncome, weeklyExpenses, weeklyMargin,
      businessNet,
      recommendedMonthlyTransfer, recommendedWeeklyTransfer, recommendedBiweeklyTransfer
    };
  }

  // ---------- debt snowball ----------
  function monthsToPayoff(balance, aprPercent, monthlyPayment) {
    balance = Number(balance) || 0;
    monthlyPayment = Number(monthlyPayment) || 0;
    if (balance <= 0) return 0;
    if (monthlyPayment <= 0) return Infinity;
    const r = (Number(aprPercent) || 0) / 100 / 12;
    if (r === 0) return Math.ceil(balance / monthlyPayment);
    if (monthlyPayment <= balance * r) return Infinity; // payment doesn't cover interest
    const n = -Math.log(1 - (r * balance) / monthlyPayment) / Math.log(1 + r);
    return Math.ceil(n);
  }

  function addMonths(date, n) {
    if (!isFinite(n)) return null;
    const d = new Date(date);
    d.setMonth(d.getMonth() + n);
    return d;
  }

  function debtProgress(debt) {
    const start = Number(debt.startBalance) || Number(debt.balance) || 0;
    const current = Number(debt.balance) || 0;
    if (start <= 0) return 0;
    const pct = ((start - current) / start) * 100;
    return Math.max(0, Math.min(100, pct));
  }

  function debtPayoffEstimate(debt) {
    if (debt.noBalance) return { months: null, date: null, monthlyPayment: toMonthly((Number(debt.minPayment) || 0) + (Number(debt.extraPayment) || 0), debt.frequency || 'monthly') };
    const monthlyPayment = debtMonthlyPayment(debt);
    const months = monthsToPayoff(debt.balance, debt.interestRate, monthlyPayment);
    const date = isFinite(months) ? addMonths(new Date(), months) : null;
    return { months, date, monthlyPayment };
  }

  // Snowball simulation: sorts active debts smallest -> largest balance,
  // funnels minimum payments everywhere + a shared extra pool at the
  // smallest remaining balance, rolling paid-off minimums into the pool.
  function simulateSnowball(debts, extraBudget) {
    const active = debts
      .filter(d => !d.noBalance && d.status !== 'paused' && Number(d.balance) > 0)
      .map(d => ({
        id: d.id,
        name: d.name,
        balance: Number(d.balance) || 0,
        apr: Number(d.interestRate) || 0,
        minPayment: toMonthly((Number(d.minPayment) || 0), d.frequency || 'monthly')
      }))
      .sort((a, b) => a.balance - b.balance);

    if (active.length === 0) {
      return { order: [], payoffDates: {}, debtFreeDate: null, months: 0, totalMinPayments: 0 };
    }

    let pool = Number(extraBudget) || 0;
    const totalMinPayments = active.reduce((s, d) => s + d.minPayment, 0);
    const payoffMonth = {};
    let month = 0;
    const MAX_MONTHS = 720; // 60 years safety cap

    while (active.some(d => d.balance > 0.005) && month < MAX_MONTHS) {
      month++;
      let freedThisMonth = 0;
      // apply minimums + interest
      active.forEach(d => {
        if (d.balance <= 0) return;
        const r = d.apr / 100 / 12;
        d.balance += d.balance * r;
        d.balance -= d.minPayment;
        if (d.balance < 0) { freedThisMonth += -d.balance; d.balance = 0; }
      });
      // apply snowball extra to smallest remaining balance
      let extraLeft = pool + freedThisMonth;
      const order = active.filter(d => d.balance > 0).sort((a, b) => a.balance - b.balance);
      for (const d of order) {
        if (extraLeft <= 0) break;
        if (d.balance <= extraLeft) { extraLeft -= d.balance; d.balance = 0; }
        else { d.balance -= extraLeft; extraLeft = 0; }
      }
      active.forEach(d => {
        if (d.balance <= 0.005 && !(d.id in payoffMonth)) payoffMonth[d.id] = month;
      });
    }

    const payoffDates = {};
    Object.keys(payoffMonth).forEach(id => { payoffDates[id] = addMonths(new Date(), payoffMonth[id]); });

    const debtFreeMonth = Math.max(0, ...Object.values(payoffMonth));
    const debtFreeDate = active.length ? addMonths(new Date(), debtFreeMonth) : null;

    return {
      order: [...debts].filter(d => !d.noBalance).sort((a, b) => (Number(a.balance) || 0) - (Number(b.balance) || 0)),
      payoffDates,
      debtFreeDate,
      months: debtFreeMonth,
      totalMinPayments
    };
  }

  function debtTotalsByCategory(debts) {
    const map = {};
    debts.forEach(d => {
      const cat = d.debtCategory || 'other';
      if (!map[cat]) map[cat] = { count: 0, balance: 0, monthly: 0 };
      map[cat].count++;
      map[cat].balance += Number(d.balance) || 0;
      map[cat].monthly += (d.status === 'paused') ? 0 : debtMonthlyPayment(d);
    });
    return map;
  }

  // ---------- calendar occurrences ----------
  function daysInMonth(year, month) { return new Date(year, month + 1, 0).getDate(); }

  function occurrencesInMonth(entry, year, month) {
    const dim = daysInMonth(year, month);
    const out = [];
    const freq = entry.frequency;

    if (freq === 'monthly') {
      const day = Math.min(Number(entry.dueDay) || 1, dim);
      out.push(new Date(year, month, day));
    } else if (freq === 'monthly-nth-weekday') {
      const nth = Number(entry.nth) || 1;
      const weekday = Number(entry.weekday) || 5;
      let count = 0;
      for (let d = 1; d <= dim; d++) {
        const dt = new Date(year, month, d);
        if (dt.getDay() === weekday) {
          count++;
          if (count === nth) { out.push(dt); break; }
        }
      }
    } else if (freq === 'weekly') {
      const weekday = Number(entry.weekday);
      for (let d = 1; d <= dim; d++) {
        const dt = new Date(year, month, d);
        if (dt.getDay() === weekday) out.push(dt);
      }
    } else if (freq === 'biweekly') {
      if (entry.anchorDate) {
        const anchor = new Date(entry.anchorDate + 'T00:00:00');
        const monthStart = new Date(year, month, 1);
        const monthEnd = new Date(year, month, dim);
        // find an occurrence on/after a safe point before monthStart
        let cursor = new Date(anchor);
        const msDay = 24 * 60 * 60 * 1000;
        const diffDays = Math.round((monthStart - cursor) / msDay);
        const stepsBack = Math.floor(diffDays / 14);
        cursor.setDate(cursor.getDate() + stepsBack * 14);
        while (cursor < monthStart) cursor.setDate(cursor.getDate() + 14);
        while (cursor <= monthEnd) {
          out.push(new Date(cursor));
          cursor.setDate(cursor.getDate() + 14);
        }
      }
    } else if (freq === 'onetime') {
      if (entry.date) {
        const dt = new Date(entry.date + 'T00:00:00');
        if (dt.getFullYear() === year && dt.getMonth() === month) out.push(dt);
      }
    }
    return out;
  }

  function buildCalendarEvents(data, year, month) {
    const events = []; // {date, name, amount, kind: bill|debt|business-expense|income|business-income, status, sign}

    data.bills.forEach(b => {
      occurrencesInMonth(b, year, month).forEach(date => {
        events.push({ date, name: b.name, amount: Number(b.amount) || 0, kind: 'bill', status: b.status, sign: -1, id: b.id });
      });
    });
    data.debts.forEach(d => {
      if (d.status === 'paused') return;
      occurrencesInMonth(d, year, month).forEach(date => {
        const amt = (Number(d.minPayment) || 0) + (Number(d.extraPayment) || 0);
        if (amt <= 0) return;
        events.push({ date, name: d.name, amount: amt, kind: 'debt', status: d.status || 'active', sign: -1, id: d.id });
      });
    });
    data.income.forEach(i => {
      occurrencesInMonth(i, year, month).forEach(date => {
        events.push({ date, name: i.name, amount: Number(i.amount) || 0, kind: 'income', status: 'active', sign: 1, id: i.id });
      });
    });
    data.business.income.forEach(i => {
      occurrencesInMonth(i, year, month).forEach(date => {
        events.push({ date, name: i.name, amount: Number(i.amount) || 0, kind: 'business-income', status: 'active', sign: 1, id: i.id });
      });
    });
    data.business.expenses.forEach(e => {
      occurrencesInMonth(e, year, month).forEach(date => {
        events.push({ date, name: e.name, amount: Number(e.amount) || 0, kind: 'business-expense', status: e.status || 'active', sign: -1, id: e.id });
      });
    });

    events.sort((a, b) => a.date - b.date);
    return events;
  }

  return {
    uid, ensureData, save, load, resetToSeed, wipe,
    toMonthly, toWeekly, toBiweekly, fmtMoney,
    computeSummary, debtMonthlyPayment,
    monthsToPayoff, addMonths, debtProgress, debtPayoffEstimate,
    simulateSnowball, debtTotalsByCategory,
    occurrencesInMonth, buildCalendarEvents, daysInMonth,
    WEEK_PER_MONTH, BIWEEK_PER_MONTH
  };
})();
