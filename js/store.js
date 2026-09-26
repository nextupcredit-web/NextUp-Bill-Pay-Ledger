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
  const DAYS_PER_YEAR = 365.25;

  const EXPENSE_CATEGORIES = ['Software', 'Fuel/Mileage', 'Supplies', 'Marketing', 'Insurance', 'Meals', 'Equipment', 'Other'];

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
      business: { income: [], expenses: [], transactions: [] },
      savings: [],
      snapshots: [],          // [{ period:'YYYY-MM', date, totalDebtBalance, monthlyMargin, totalIncomeMonthly, totalExpensesMonthly, savingsMonthly }]
      creditScore: {
        bureaus: {
          experian: { current: null, history: [] },   // history: [{date, score}]
          transunion: { current: null, history: [] },
          equifax: { current: null, history: [] }
        }
      }
    };
  }

  const CREDIT_BUREAUS = ['experian', 'transunion', 'equifax'];
  const CREDIT_BUREAU_LABELS = { experian: 'Experian', transunion: 'TransUnion', equifax: 'Equifax' };

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
    data.business = data.business || { income: [], expenses: [], transactions: [] };
    data.business.income = data.business.income || [];
    data.business.expenses = data.business.expenses || [];
    data.business.transactions = data.business.transactions || [];
    data.income = data.income || [];
    data.bills = data.bills || [];
    data.debts = data.debts || [];
    data.savings = data.savings || [];
    data.income.forEach(i => {
      if (i.payStructure === undefined) i.payStructure = 'none';
      if (i.hoursPerWeek === undefined) i.hoursPerWeek = 40;
      if (i.hourlyRate === undefined) i.hourlyRate = 0;
      if (i.annualSalary === undefined) i.annualSalary = 0;
      if (i.taxRatePercent === undefined) i.taxRatePercent = i.type === 'w2' ? 22 : 0;
      if (i.useYtdAverage === undefined) i.useYtdAverage = false;
      if (i.ytdGross === undefined) i.ytdGross = 0;
      if (i.ytdStartDate === undefined) i.ytdStartDate = `${new Date().getFullYear()}-01-01`;
    });
    data.savings.forEach(s => {
      if (s.category === undefined) s.category = 'savings';
      if (s.kind === undefined) s.kind = 'transfer';
      if (s.notes === undefined) s.notes = '';
    });
    data.snapshots = data.snapshots || [];
    if (!data.creditScore || !data.creditScore.bureaus) {
      // Migrate/initialize to the per-bureau shape. Any older single-score
      // shape (current/history/affiliateUrl) is dropped rather than guessed
      // into a bureau, since we can't know which bureau it came from.
      data.creditScore = { bureaus: {} };
    }
    delete data.creditScore.affiliateUrl;
    delete data.creditScore.current;
    delete data.creditScore.history;
    data.creditScore.bureaus = data.creditScore.bureaus || {};
    CREDIT_BUREAUS.forEach(b => {
      data.creditScore.bureaus[b] = data.creditScore.bureaus[b] || { current: null, history: [] };
      if (data.creditScore.bureaus[b].current === undefined) data.creditScore.bureaus[b].current = null;
      data.creditScore.bureaus[b].history = data.creditScore.bureaus[b].history || [];
    });
    return data;
  }

  // ---------- snapshots (historical progress) & credit score ----------
  function computeSnapshotMetrics(data) {
    const summary = computeSummary(data);
    const totalDebtBalance = data.debts.filter(d => !d.noBalance).reduce((s, d) => s + (Number(d.balance) || 0), 0);
    return {
      totalDebtBalance,
      monthlyMargin: summary.monthlyMargin,
      totalIncomeMonthly: summary.totalIncomeMonthly,
      totalExpensesMonthly: summary.totalExpensesMonthly,
      savingsMonthly: summary.savingsTotals.monthly
    };
  }

  // Call once per session after ensureData(). Writes at most one snapshot per
  // calendar month (keyed by 'YYYY-MM'); caller is responsible for persisting
  // via save() if this returns true.
  function captureSnapshotIfNeeded(data) {
    const now = new Date();
    const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    data.snapshots = data.snapshots || [];
    if (data.snapshots.some(s => s.period === period)) return false;
    const metrics = computeSnapshotMetrics(data);
    data.snapshots.push({ period, date: now.toISOString().slice(0, 10), ...metrics });
    data.snapshots.sort((a, b) => a.period.localeCompare(b.period));
    if (data.snapshots.length > 60) data.snapshots = data.snapshots.slice(-60);
    return true;
  }

  function addCreditScoreEntry(data, bureau, score, dateStr) {
    if (!CREDIT_BUREAUS.includes(bureau)) return;
    data.creditScore = data.creditScore || { bureaus: {} };
    data.creditScore.bureaus = data.creditScore.bureaus || {};
    const rec = data.creditScore.bureaus[bureau] = data.creditScore.bureaus[bureau] || { current: null, history: [] };
    rec.history = rec.history || [];
    const d = dateStr || new Date().toISOString().slice(0, 10);
    const clamped = Math.max(300, Math.min(900, Number(score) || 0));
    const existingIdx = rec.history.findIndex(h => h.date === d);
    if (existingIdx >= 0) rec.history[existingIdx].score = clamped;
    else rec.history.push({ date: d, score: clamped });
    rec.history.sort((a, b) => a.date.localeCompare(b.date));
    rec.current = clamped;
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

  function toYearly(amount, frequency) {
    if (frequency === 'onetime') return Number(amount) || 0;
    return toMonthly(amount, frequency) * 12;
  }

  // ---------- income pay-structure / net pay (estimate only) ----------
  function periodsPerYear(frequency) {
    switch (frequency) {
      case 'weekly': return 52;
      case 'biweekly': return 26;
      case 'semimonthly': return 24;
      case 'monthly': return 12;
      default: return 12;
    }
  }

  // Returns the NET (post-tax/insurance/retirement, estimated) amount for one
  // pay period, given the item's chosen entry method. This is the number that
  // gets written into item.amount so every existing consumer (calendar,
  // computeSummary, etc.) keeps working unchanged.
  function computeNetPayAmount(item) {
    if (item.type !== 'w2' || !item.payStructure || item.payStructure === 'none') {
      return Number(item.amount) || 0;
    }
    const taxRate = Math.max(0, Math.min(100, Number(item.taxRatePercent) || 0));
    let grossPerPeriod;
    if (item.useYtdAverage) {
      const start = new Date((item.ytdStartDate || `${new Date().getFullYear()}-01-01`) + 'T00:00:00');
      const days = Math.max(1, Math.round((new Date() - start) / 86400000));
      const grossPerDay = (Number(item.ytdGross) || 0) / days;
      grossPerPeriod = (grossPerDay * DAYS_PER_YEAR) / periodsPerYear(item.frequency);
    } else if (item.payStructure === 'hourly') {
      const weeksPerPeriod = { weekly: 1, biweekly: 2, semimonthly: WEEK_PER_MONTH / 2, monthly: WEEK_PER_MONTH }[item.frequency] || 1;
      grossPerPeriod = (Number(item.hourlyRate) || 0) * (Number(item.hoursPerWeek) || 0) * weeksPerPeriod;
    } else if (item.payStructure === 'salary') {
      grossPerPeriod = (Number(item.annualSalary) || 0) / periodsPerYear(item.frequency);
    } else {
      grossPerPeriod = Number(item.amount) || 0;
    }
    return grossPerPeriod * (1 - taxRate / 100);
  }

  // ---------- business P&L (proration + dated transactions) ----------
  function prorateToRange(items, start, end) {
    const days = Math.max(1, Math.round((end - start) / 86400000) + 1);
    return items.reduce((s, item) => {
      const yearly = toYearly(item.amount, item.frequency);
      return s + (yearly / DAYS_PER_YEAR) * days;
    }, 0);
  }

  function periodRange(period, customStart, customEnd) {
    const now = new Date();
    if (period === 'week') {
      const day = now.getDay();
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day);
      const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6, 23, 59, 59, 999);
      return { start, end };
    }
    if (period === 'year') {
      return { start: new Date(now.getFullYear(), 0, 1), end: new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999) };
    }
    if (period === 'custom') {
      const start = customStart ? new Date(customStart + 'T00:00:00') : new Date(now.getFullYear(), now.getMonth(), 1);
      const end = customEnd ? new Date(customEnd + 'T23:59:59') : now;
      return { start, end: end < start ? start : end };
    }
    // default: month
    return { start: new Date(now.getFullYear(), now.getMonth(), 1), end: new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999) };
  }

  function transactionsInRange(transactions, start, end) {
    return (transactions || []).filter(t => {
      if (!t.date) return false;
      const d = new Date(t.date + 'T12:00:00');
      return d >= start && d <= end;
    });
  }

  function computeBusinessPnL(data, period, customStart, customEnd) {
    const { start, end } = periodRange(period, customStart, customEnd);
    const recurringIncome = prorateToRange(data.business.income, start, end);
    const recurringExpense = prorateToRange(data.business.expenses, start, end);
    const txns = transactionsInRange(data.business.transactions, start, end);
    const txnIncome = txns.filter(t => t.type === 'income').reduce((s, t) => s + (Number(t.amount) || 0), 0);
    const txnExpense = txns.filter(t => t.type === 'expense').reduce((s, t) => s + (Number(t.amount) || 0), 0);
    const totalIncome = recurringIncome + txnIncome;
    const totalExpense = recurringExpense + txnExpense;

    const categoryTotals = {};
    if (recurringExpense > 0) categoryTotals['Recurring Fixed'] = recurringExpense;
    txns.filter(t => t.type === 'expense').forEach(t => {
      const cat = t.category || 'Other';
      categoryTotals[cat] = (categoryTotals[cat] || 0) + (Number(t.amount) || 0);
    });

    return {
      start, end, txns,
      recurringIncome, recurringExpense, txnIncome, txnExpense,
      totalIncome, totalExpense, net: totalIncome - totalExpense,
      categoryTotals
    };
  }

  // ---------- savings / investing / retirement ----------
  function computeSavingsTotals(savings) {
    const items = savings || [];
    const monthly = items.reduce((s, x) => s + toMonthly(x.amount, x.frequency), 0);
    const expenseMonthly = items.filter(x => x.kind === 'expense').reduce((s, x) => s + toMonthly(x.amount, x.frequency), 0);
    const transferMonthly = items.filter(x => x.kind === 'transfer').reduce((s, x) => s + toMonthly(x.amount, x.frequency), 0);
    return { monthly, expenseMonthly, transferMonthly, weekly: monthly / WEEK_PER_MONTH };
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
    const savingsTotals = computeSavingsTotals(data.savings);
    const totalExpensesMonthly = billsMonthly + debtsMonthly + businessExpMonthly + savingsTotals.expenseMonthly;

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
      businessNet, savingsTotals,
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
    (data.business.transactions || []).forEach(t => {
      if (!t.date) return;
      const d = new Date(t.date + 'T00:00:00');
      if (d.getFullYear() === year && d.getMonth() === month) {
        events.push({ date: d, name: t.name, amount: Number(t.amount) || 0, kind: t.type === 'income' ? 'business-income' : 'business-expense', status: 'active', sign: t.type === 'income' ? 1 : -1, id: t.id });
      }
    });

    events.sort((a, b) => a.date - b.date);
    return events;
  }

  return {
    uid, ensureData, save, load, resetToSeed, wipe,
    toMonthly, toWeekly, toBiweekly, toYearly, fmtMoney,
    computeSummary, debtMonthlyPayment,
    monthsToPayoff, addMonths, debtProgress, debtPayoffEstimate,
    simulateSnowball, debtTotalsByCategory,
    occurrencesInMonth, buildCalendarEvents, daysInMonth,
    computeNetPayAmount, periodsPerYear,
    periodRange, computeBusinessPnL, transactionsInRange,
    computeSavingsTotals,
    computeSnapshotMetrics, captureSnapshotIfNeeded, addCreditScoreEntry,
    EXPENSE_CATEGORIES,
    CREDIT_BUREAUS, CREDIT_BUREAU_LABELS,
    WEEK_PER_MONTH, BIWEEK_PER_MONTH
  };
})();
