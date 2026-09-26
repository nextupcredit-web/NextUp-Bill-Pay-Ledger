/* ============================================================
   NextUp Bill Pay Ledger — Starter Seed Data
   buildOwner() holds the real data for the single owner account.
   buildDemo() is generic sample data every other account (landing
   page, guests, new signups) gets instead. Every item is fully
   editable/deletable once loaded.
   ============================================================ */

const NextUpSeed = (() => {
  const u = (prefix) => (typeof NextUpStore !== 'undefined' ? NextUpStore.uid(prefix) : prefix + '_' + Math.random().toString(36).slice(2, 9));

  function buildOwner() {
    return {
      meta: { version: 1, createdAt: new Date().toISOString() },
      settings: {
        weeklyBuffer: 100,
        customTransferAmount: null,
        customTransferFrequency: 'weekly',
        snowballExtra: 0
      },

      income: [
        { id: u('inc'), name: 'Trucking Paycheck (W2)', owner: 'personal', type: 'w2', amount: 1340.23, frequency: 'weekly', weekday: 5, notes: 'Net after 10% auto-save to Amex HYSA' }
      ],

      bills: [
        { id: u('bill'), name: 'Mortgage — Taxes & Insurance', amount: 155.08, frequency: 'weekly', weekday: 2, status: 'active', notes: 'Escrow — fixed, does not change' },
        { id: u('bill'), name: 'Gas', amount: 178.00, frequency: 'monthly', dueDay: 3, status: 'active', notes: 'Budget billing — fixed monthly amount' },
        { id: u('bill'), name: 'Kovo', amount: 10.00, frequency: 'monthly', dueDay: 3, status: 'pending', notes: 'Old card — pending new card' },
        { id: u('bill'), name: 'Lincoln Life Insurance', amount: 68.15, frequency: 'monthly', dueDay: 4, status: 'pending', notes: 'Website down — bank switch pending' },
        { id: u('bill'), name: 'Ring (cameras)', amount: 10.59, frequency: 'monthly', dueDay: 5, status: 'pending', notes: 'Old card — pending new card' },
        { id: u('bill'), name: 'Electric', amount: 267.00, frequency: 'monthly', dueDay: 8, status: 'active', notes: 'Budget billing — fixed monthly amount' },
        { id: u('bill'), name: 'Allstate (car insurance)', amount: 283.47, frequency: 'monthly', dueDay: 9, status: 'active', notes: '' },
        { id: u('bill'), name: 'YouTube', amount: 20.99, frequency: 'monthly', dueDay: 11, status: 'active', notes: '' },
        { id: u('bill'), name: 'Amazon Prime', amount: 14.99, frequency: 'monthly', dueDay: 14, status: 'pending', notes: 'Old card — pending new card' },
        { id: u('bill'), name: 'Verizon / WiFi', amount: 70.00, frequency: 'monthly', dueDay: 16, status: 'active', notes: '' },
        { id: u('bill'), name: 'Instagram subscription', amount: 14.99, frequency: 'monthly', dueDay: 16, status: 'active', notes: '' },
        { id: u('bill'), name: 'iCloud', amount: 9.99, frequency: 'monthly', dueDay: 16, status: 'active', notes: '' },
        { id: u('bill'), name: 'Planet Fitness', amount: 15.00, frequency: 'monthly', dueDay: 17, status: 'active', notes: '' },
        { id: u('bill'), name: 'Water', amount: 189.00, frequency: 'monthly', dueDay: 25, status: 'manual', pastDue: 400.00, notes: 'Flood catch-up — manual login required until caught up' },
        { id: u('bill'), name: 'Trash', amount: 31.00, frequency: 'monthly-nth-weekday', nth: 1, weekday: 5, status: 'pending', notes: '1st Friday of the month — old card, pending new card' },
        { id: u('bill'), name: 'T-Mobile (biweekly)', amount: 153.64, frequency: 'biweekly', anchorDate: '2026-09-25', status: 'active', notes: 'Lost the $20/mo autopay discount to smooth cash flow' },
        { id: u('bill'), name: 'Groceries (Zelle)', amount: 100.00, frequency: 'weekly', weekday: 6, status: 'active', notes: 'Spending account, not bills autopay' },
        { id: u('bill'), name: 'Business support transfer (out)', amount: 126.45, frequency: 'weekly', weekday: 4, status: 'active', notes: 'Fronts the NextUp Enterprise office/expense gap until the business covers itself' }
      ],

      debts: [
        { id: u('debt'), name: 'Sparrow', debtCategory: 'credit-card', balance: 212.25, startBalance: 212.25, interestRate: 0, minPayment: 35.00, extraPayment: 0, frequency: 'monthly', dueDay: 26, status: 'active', notes: '' },
        { id: u('debt'), name: 'Mission Lane', debtCategory: 'credit-card', balance: 243.85, startBalance: 243.85, interestRate: 0, minPayment: 25.00, extraPayment: 0, frequency: 'monthly', dueDay: 2, status: 'active', notes: '' },
        { id: u('debt'), name: 'Total Visa', debtCategory: 'credit-card', balance: 415.46, startBalance: 415.46, interestRate: 0, minPayment: 41.00, extraPayment: 0, frequency: 'monthly', dueDay: 28, status: 'active', notes: "Site down — pending autopay switch" },
        { id: u('debt'), name: 'Milestone', debtCategory: 'credit-card', balance: 419.73, startBalance: 419.73, interestRate: 0, minPayment: 40.00, extraPayment: 0, frequency: 'monthly', dueDay: 25, status: 'active', notes: '' },
        { id: u('debt'), name: 'Fortiva', debtCategory: 'credit-card', balance: 439.66, startBalance: 439.66, interestRate: 0, minPayment: 38.66, extraPayment: 0, frequency: 'monthly', dueDay: 2, status: 'active', notes: '' },
        { id: u('debt'), name: 'Credit One', debtCategory: 'credit-card', balance: 442.45, startBalance: 442.45, interestRate: 0, minPayment: 30.00, extraPayment: 0, frequency: 'monthly', dueDay: 22, status: 'active', notes: 'Pending new bank account verification' },
        { id: u('debt'), name: 'Indigo (…9133)', debtCategory: 'credit-card', balance: 461.18, startBalance: 461.18, interestRate: 0, minPayment: 40.00, extraPayment: 0, frequency: 'monthly', dueDay: 11, status: 'active', notes: '' },
        { id: u('debt'), name: 'Indigo (…1153)', debtCategory: 'credit-card', balance: 938.25, startBalance: 938.25, interestRate: 0, minPayment: 47.00, extraPayment: 0, frequency: 'monthly', dueDay: 11, status: 'active', notes: '' },
        { id: u('debt'), name: 'Petal', debtCategory: 'credit-card', balance: 1270.33, startBalance: 1270.33, interestRate: 0, minPayment: 48.00, extraPayment: 0, frequency: 'monthly', dueDay: 26, status: 'active', notes: '' },
        { id: u('debt'), name: 'Ollo', debtCategory: 'credit-card', balance: 1450.88, startBalance: 1450.88, interestRate: 0, minPayment: 51.00, extraPayment: 0, frequency: 'monthly', dueDay: 12, status: 'active', notes: 'Autopay being set up' },

        { id: u('debt'), name: 'Afterpay', debtCategory: 'bnpl', balance: 66.00, startBalance: 66.00, interestRate: 0, minPayment: 0, extraPayment: 0, frequency: 'monthly', dueDay: null, status: 'paused', notes: 'No set schedule — paying whenever able' },
        { id: u('debt'), name: 'Klarna', debtCategory: 'bnpl', balance: 347.94, startBalance: 347.94, interestRate: 0, minPayment: 0, extraPayment: 0, frequency: 'monthly', dueDay: null, status: 'paused', notes: 'Normally $87.07/mo — paused, working out a plan' },

        { id: u('debt'), name: 'January (collections)', debtCategory: 'collections', balance: 1565.92, startBalance: 1565.92, interestRate: 0, minPayment: 0, extraPayment: 0, frequency: 'monthly', dueDay: null, status: 'paused', notes: 'Normally $190/mo — currently paused' },

        { id: u('debt'), name: 'Mass Tax Connect', debtCategory: 'tax', balance: 2613.26, startBalance: 2613.26, interestRate: 0, minPayment: 0, extraPayment: 0, frequency: 'monthly', dueDay: null, status: 'paused', notes: 'Currently paused' },
        { id: u('debt'), name: 'PA Tax Bill', debtCategory: 'tax', balance: 10112.88, startBalance: 10112.88, interestRate: 0, minPayment: 0, extraPayment: 0, frequency: 'monthly', dueDay: null, status: 'paused', notes: 'Normally $247/mo — currently paused' },

        { id: u('debt'), name: 'Mohela (student loan)', debtCategory: 'student-loan', balance: 7371.56, startBalance: 7371.56, interestRate: 0, minPayment: 0, extraPayment: 0, frequency: 'monthly', dueDay: null, status: 'paused', notes: 'Deferred — no payment currently' },

        { id: u('debt'), name: 'TFS (legal)', debtCategory: 'legal', balance: 0, startBalance: 0, noBalance: true, interestRate: 0, minPayment: 86.37, extraPayment: 0, frequency: 'weekly', weekday: 2, status: 'active', targetDate: '2027-04-01', notes: 'Payment plan — no fixed balance, target payoff by Apr 2027' },

        { id: u('debt'), name: 'Mortgage (Principal)', debtCategory: 'mortgage', balance: 130942.51, startBalance: 130942.51, interestRate: 0, minPayment: 144.92, extraPayment: 0, frequency: 'weekly', weekday: 2, status: 'active', pastDue: 772.00, notes: '$772 past due, being paid off separately from the weekly amount' }
      ],

      business: {
        income: [
          { id: u('bizinc'), name: 'Client A ($149/mo)', owner: 'business', amount: 149.00, frequency: 'monthly', dueDay: 11, notes: 'Profit ≈$122/mo after variable costs' },
          { id: u('bizinc'), name: 'Client B ($129/mo)', owner: 'business', amount: 129.00, frequency: 'monthly', dueDay: 5, notes: 'Profit ≈$118/mo after variable costs' },
          { id: u('bizinc'), name: 'Client C ($129/mo)', owner: 'business', amount: 129.00, frequency: 'monthly', dueDay: 5, notes: 'Profit ≈$103/mo — credit monitoring sponsored by us' },
          { id: u('bizinc'), name: 'Business support transfer (in)', owner: 'business', amount: 126.45, frequency: 'weekly', weekday: 4, notes: 'From personal Bills Autopay, fronting the gap until the business covers itself' }
        ],
        expenses: [
          { id: u('bizexp'), name: 'Office rent', amount: 600.00, frequency: 'monthly', dueDay: 1, status: 'active', notes: 'Starts Nov 1, 2026' },
          { id: u('bizexp'), name: 'Credit Repair Cloud', amount: 189.74, frequency: 'monthly', dueDay: 2, status: 'active', notes: 'CRM / dispute platform' },
          { id: u('bizexp'), name: 'Skool', amount: 9.00, frequency: 'monthly', dueDay: 10, status: 'active', notes: 'Building a course for active clients' },
          { id: u('bizexp'), name: 'Credit Hero', amount: 30.00, frequency: 'monthly', dueDay: 15, status: 'active', notes: '2 accounts, for 2 sponsored clients' },
          { id: u('bizexp'), name: 'Claude', amount: 21.20, frequency: 'monthly', dueDay: 20, status: 'active', notes: '' },
          { id: u('bizexp'), name: 'QuickBooks', amount: 40.00, frequency: 'monthly', dueDay: 24, status: 'active', notes: '' }
        ]
      }
    };
  }

  function buildDemo() {
    return {
      meta: { version: 1, createdAt: new Date().toISOString() },
      settings: {
        weeklyBuffer: 75,
        customTransferAmount: null,
        customTransferFrequency: 'weekly',
        snowballExtra: 0
      },

      income: [
        { id: u('inc'), name: 'Paycheck (W2)', owner: 'personal', type: 'w2', amount: 975.00, frequency: 'biweekly', anchorDate: '2026-09-26', notes: 'Direct deposit' }
      ],

      bills: [
        { id: u('bill'), name: 'Rent', amount: 1450.00, frequency: 'monthly', dueDay: 1, status: 'active', notes: '' },
        { id: u('bill'), name: 'Electric', amount: 110.00, frequency: 'monthly', dueDay: 5, status: 'active', notes: '' },
        { id: u('bill'), name: 'Internet', amount: 60.00, frequency: 'monthly', dueDay: 7, status: 'active', notes: '' },
        { id: u('bill'), name: 'Phone', amount: 55.00, frequency: 'monthly', dueDay: 10, status: 'active', notes: '' },
        { id: u('bill'), name: 'Car Insurance', amount: 145.00, frequency: 'monthly', dueDay: 12, status: 'active', notes: '' },
        { id: u('bill'), name: 'Streaming (bundle)', amount: 24.99, frequency: 'monthly', dueDay: 15, status: 'active', notes: '' },
        { id: u('bill'), name: 'Groceries', amount: 120.00, frequency: 'weekly', weekday: 6, status: 'active', notes: '' },
        { id: u('bill'), name: 'Gym', amount: 25.00, frequency: 'monthly', dueDay: 18, status: 'active', notes: '' }
      ],

      debts: [
        { id: u('debt'), name: 'Visa Card', debtCategory: 'credit-card', balance: 1850.00, startBalance: 2400.00, interestRate: 0, minPayment: 55.00, extraPayment: 0, frequency: 'monthly', dueDay: 20, status: 'active', notes: '' },
        { id: u('debt'), name: 'Store Card', debtCategory: 'credit-card', balance: 620.00, startBalance: 900.00, interestRate: 0, minPayment: 30.00, extraPayment: 0, frequency: 'monthly', dueDay: 22, status: 'active', notes: '' },
        { id: u('debt'), name: 'Car Loan', debtCategory: 'auto-loan', balance: 9800.00, startBalance: 15000.00, interestRate: 0, minPayment: 285.00, extraPayment: 0, frequency: 'monthly', dueDay: 3, status: 'active', notes: '' },
        { id: u('debt'), name: 'Student Loan', debtCategory: 'student-loan', balance: 12500.00, startBalance: 18000.00, interestRate: 0, minPayment: 150.00, extraPayment: 0, frequency: 'monthly', dueDay: 25, status: 'active', notes: '' }
      ],

      business: {
        income: [
          { id: u('bizinc'), name: 'Freelance Client A', owner: 'business', amount: 600.00, frequency: 'monthly', dueDay: 5, notes: 'Retainer' },
          { id: u('bizinc'), name: 'Freelance Client B', owner: 'business', amount: 350.00, frequency: 'monthly', dueDay: 18, notes: 'Project work' }
        ],
        expenses: [
          { id: u('bizexp'), name: 'Software subscriptions', amount: 45.00, frequency: 'monthly', dueDay: 1, status: 'active', notes: '' },
          { id: u('bizexp'), name: 'Business insurance', amount: 60.00, frequency: 'monthly', dueDay: 15, status: 'active', notes: '' }
        ],
        transactions: []
      },

      savings: [
        { id: u('sav'), name: 'Emergency Fund', category: 'savings', kind: 'transfer', amount: 150.00, frequency: 'monthly', dueDay: 1, notes: 'High-yield savings account' },
        { id: u('sav'), name: '401k Contribution', category: 'retirement', kind: 'expense', amount: 200.00, frequency: 'monthly', dueDay: 1, notes: 'Employer match 3%' },
        { id: u('sav'), name: 'Brokerage (Index Funds)', category: 'investing', kind: 'transfer', amount: 100.00, frequency: 'monthly', dueDay: 15, notes: '' }
      ],

      creditScore: {
        bureaus: {
          experian: { current: 682, history: [
            { date: '2026-05-01', score: 641 }, { date: '2026-06-01', score: 652 },
            { date: '2026-07-01', score: 660 }, { date: '2026-08-01', score: 671 },
            { date: '2026-09-01', score: 682 }
          ] },
          transunion: { current: 675, history: [
            { date: '2026-05-01', score: 630 }, { date: '2026-06-01', score: 644 },
            { date: '2026-07-01', score: 655 }, { date: '2026-08-01', score: 664 },
            { date: '2026-09-01', score: 675 }
          ] },
          equifax: { current: 669, history: [
            { date: '2026-05-01', score: 625 }, { date: '2026-06-01', score: 638 },
            { date: '2026-07-01', score: 649 }, { date: '2026-08-01', score: 658 },
            { date: '2026-09-01', score: 669 }
          ] }
        }
      },

      snapshots: [
        { period: '2026-05', date: '2026-05-01', totalDebtBalance: 27100, monthlyMargin: 210, totalIncomeMonthly: 3060, totalExpensesMonthly: 2850, savingsMonthly: 350 },
        { period: '2026-06', date: '2026-06-01', totalDebtBalance: 26200, monthlyMargin: 260, totalIncomeMonthly: 3060, totalExpensesMonthly: 2800, savingsMonthly: 400 },
        { period: '2026-07', date: '2026-07-01', totalDebtBalance: 25550, monthlyMargin: 300, totalIncomeMonthly: 3120, totalExpensesMonthly: 2820, savingsMonthly: 420 },
        { period: '2026-08', date: '2026-08-01', totalDebtBalance: 24900, monthlyMargin: 340, totalIncomeMonthly: 3120, totalExpensesMonthly: 2780, savingsMonthly: 450 },
        { period: '2026-09', date: '2026-09-01', totalDebtBalance: 24770, monthlyMargin: 375, totalIncomeMonthly: 3170, totalExpensesMonthly: 2795, savingsMonthly: 450 }
      ]
    };
  }

  return { buildOwner, buildDemo };
})();
