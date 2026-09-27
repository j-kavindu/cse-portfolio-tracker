const assert = require("assert");
const Calc = require("../js/calculator.js");

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log("PASS:", name);
  } catch (e) {
    console.log("FAIL:", name, "-", e.message);
    process.exitCode = 1;
  }
}

function mkTxn(o, i) {
  const fee = o.fee != null ? o.fee : Calc.computeFee(o.quantity, o.price, 0.0065);
  return { id: i, date: o.date, symbol: o.symbol, type: o.type, quantity: o.quantity, price: o.price, fee };
}

// 1. BUY -> holding creation
test("BUY creates a holding with correct avg cost", () => {
  const txns = [mkTxn({ date: "2026-01-01", symbol: "JKH", type: "BUY", quantity: 100, price: 150 }, 1)];
  const r = Calc.replaySymbol(txns);
  assert.strictEqual(r.qty, 100);
  const expectedFee = Calc.computeFee(100, 150, 0.0065);
  const expectedAvg = Calc.round2((100 * 150 + expectedFee) / 100);
  assert.strictEqual(r.avgCost, expectedAvg);
});

// 2. multiple BUYs -> weighted average cost
test("multiple BUYs produce weighted average cost", () => {
  const txns = [
    mkTxn({ date: "2026-01-01", symbol: "JKH", type: "BUY", quantity: 100, price: 100, fee: 0 }, 1),
    mkTxn({ date: "2026-02-01", symbol: "JKH", type: "BUY", quantity: 100, price: 200, fee: 0 }, 2),
  ];
  const r = Calc.replaySymbol(txns);
  assert.strictEqual(r.qty, 200);
  assert.strictEqual(r.avgCost, 150); // (100*100 + 100*200) / 200
});

// 3. BUY -> partial SELL
test("partial sell reduces qty and cost basis proportionally, keeps avg cost", () => {
  const txns = [
    mkTxn({ date: "2026-01-01", symbol: "JKH", type: "BUY", quantity: 100, price: 100, fee: 0 }, 1),
    mkTxn({ date: "2026-02-01", symbol: "JKH", type: "SELL", quantity: 40, price: 120, fee: 0 }, 2),
  ];
  const r = Calc.replaySymbol(txns);
  assert.strictEqual(r.qty, 60);
  assert.strictEqual(r.avgCost, 100); // unchanged by selling
  assert.strictEqual(r.costBasis, 6000); // 60 * 100
  assert.strictEqual(r.realizedPL, 800); // 40*(120-100)
});

// 4. BUY -> complete SELL
test("complete sell zeroes qty and cost basis, realizes full P/L", () => {
  const txns = [
    mkTxn({ date: "2026-01-01", symbol: "JKH", type: "BUY", quantity: 100, price: 100, fee: 0 }, 1),
    mkTxn({ date: "2026-02-01", symbol: "JKH", type: "SELL", quantity: 100, price: 130, fee: 0 }, 2),
  ];
  const r = Calc.replaySymbol(txns);
  assert.strictEqual(r.qty, 0);
  assert.strictEqual(r.costBasis, 0);
  assert.strictEqual(r.realizedPL, 3000);

  // A fully-exited symbol must NOT show up as a phantom loss in Holdings
  const { holdings, totalRealizedPL } = Calc.buildHoldings(txns, [{ symbol: "JKH", currentPrice: 999 }]);
  assert.strictEqual(holdings.length, 0);
  assert.strictEqual(totalRealizedPL, 3000);
});

// 5. oversell attempt -> rejected (validation layer)
test("oversell is rejected by validateTransaction, not silently clamped", () => {
  const held = 100;
  const res = Calc.validateTransaction({ date: "2026-02-01", symbol: "JKH", type: "SELL", quantity: 150, price: 100, fee: 0 }, held);
  assert.strictEqual(res.valid, false);
  assert.ok(/only hold/.test(res.message));
});

// oversell mid-history (post-edit) is flagged, not clamped silently in aggregate calc
test("historical oversell is surfaced via brokenAt, quantity floors at zero not negative", () => {
  const txns = [
    mkTxn({ date: "2026-01-01", symbol: "JKH", type: "BUY", quantity: 50, price: 100, fee: 0 }, 1),
    mkTxn({ date: "2026-02-01", symbol: "JKH", type: "SELL", quantity: 80, price: 100, fee: 0 }, 2),
  ];
  const r = Calc.replaySymbol(txns);
  assert.ok(r.brokenAt);
  assert.strictEqual(r.qty, 0);
});

// 6. different fees
test("different brokerage fees affect cash impact correctly", () => {
  const buy = mkTxn({ date: "2026-01-01", symbol: "JKH", type: "BUY", quantity: 10, price: 100, fee: 5 }, 1);
  const sell = mkTxn({ date: "2026-01-02", symbol: "JKH", type: "SELL", quantity: 10, price: 100, fee: 5 }, 2);
  assert.strictEqual(Calc.transactionCashImpact(buy), -(1000 + 5));
  assert.strictEqual(Calc.transactionCashImpact(sell), 1000 - 5);
});

// 7. price updates -> unrealized P/L
test("manual price update changes market value and unrealized P/L", () => {
  const txns = [mkTxn({ date: "2026-01-01", symbol: "JKH", type: "BUY", quantity: 100, price: 100, fee: 0 }, 1)];
  let r = Calc.buildHoldings(txns, [{ symbol: "JKH", currentPrice: 100 }]);
  assert.strictEqual(r.holdings[0].unrealizedPL, 0);
  r = Calc.buildHoldings(txns, [{ symbol: "JKH", currentPrice: 120 }]);
  assert.strictEqual(r.holdings[0].unrealizedPL, 2000);
  assert.strictEqual(r.holdings[0].unrealizedPLPct, 0.2);
});

// 8. realized P/L across multiple symbols totals correctly
test("portfolio-level realized P/L sums across symbols", () => {
  const txns = [
    mkTxn({ date: "2026-01-01", symbol: "JKH", type: "BUY", quantity: 100, price: 100, fee: 0 }, 1),
    mkTxn({ date: "2026-02-01", symbol: "JKH", type: "SELL", quantity: 100, price: 110, fee: 0 }, 2),
    mkTxn({ date: "2026-01-01", symbol: "COMB", type: "BUY", quantity: 50, price: 50, fee: 0 }, 3),
    mkTxn({ date: "2026-02-01", symbol: "COMB", type: "SELL", quantity: 50, price: 40, fee: 0 }, 4),
  ];
  const r = Calc.buildHoldings(txns, []);
  assert.strictEqual(r.totalRealizedPL, 1000 - 500); // +1000 on JKH, -500 on COMB
});

// 9. dividend entry: shares held strictly before record date
test("dividend shares-held uses transactions strictly before the record date", () => {
  const txns = [
    mkTxn({ date: "2026-01-01", symbol: "JKH", type: "BUY", quantity: 100, price: 100, fee: 0 }, 1),
    mkTxn({ date: "2026-03-05", symbol: "JKH", type: "BUY", quantity: 50, price: 110, fee: 0 }, 2),
  ];
  const rows = Calc.computeDividendRows([{ symbol: "JKH", recordDate: "2026-03-05", dividendPerShare: 2 }], txns, 0.15);
  assert.strictEqual(rows[0].sharesHeld, 100); // the same-day buy does not count
  assert.strictEqual(rows[0].grossDividend, 200);
  assert.strictEqual(rows[0].netDividend, 170);
});

// 10. cash movements: buy/sell + dividends + manual adjustment
test("cash flow combines trading, dividends and manual adjustments", () => {
  const txns = [
    mkTxn({ date: "2026-01-01", symbol: "JKH", type: "BUY", quantity: 100, price: 100, fee: 10 }, 1),
    mkTxn({ date: "2026-02-01", symbol: "JKH", type: "SELL", quantity: 50, price: 120, fee: 5 }, 2),
  ];
  const dividendRows = [{ netDividend: 170 }];
  const adjustments = [{ amount: 5000 }];
  const cf = Calc.computeCashFlow(txns, dividendRows, adjustments);
  const expectedTrading = -(100 * 100 + 10) + (50 * 120 - 5);
  assert.strictEqual(cf.netTradingCash, expectedTrading);
  assert.strictEqual(cf.netDividends, 170);
  assert.strictEqual(cf.netAdjustments, 5000);
  assert.strictEqual(cf.cashBalance, Calc.round2(expectedTrading + 170 + 5000));
});

// 11. transaction edit / 12. deletion — simulated by re-running replaySymbol on mutated arrays
test("editing a transaction changes downstream holdings deterministically", () => {
  let txns = [mkTxn({ date: "2026-01-01", symbol: "JKH", type: "BUY", quantity: 100, price: 100, fee: 0 }, 1)];
  let r = Calc.replaySymbol(txns);
  assert.strictEqual(r.avgCost, 100);
  txns = [mkTxn({ date: "2026-01-01", symbol: "JKH", type: "BUY", quantity: 100, price: 150, fee: 0 }, 1)]; // edited price
  r = Calc.replaySymbol(txns);
  assert.strictEqual(r.avgCost, 150);
});

test("deleting a transaction removes its effect", () => {
  let txns = [
    mkTxn({ date: "2026-01-01", symbol: "JKH", type: "BUY", quantity: 100, price: 100, fee: 0 }, 1),
    mkTxn({ date: "2026-02-01", symbol: "JKH", type: "BUY", quantity: 50, price: 200, fee: 0 }, 2),
  ];
  txns = txns.filter((t) => t.id !== 2); // delete txn 2
  const r = Calc.replaySymbol(txns);
  assert.strictEqual(r.qty, 100);
  assert.strictEqual(r.avgCost, 100);
});

// 13. backdated transaction re-orders correctly regardless of insertion order
test("backdated transaction is replayed in date order, not insertion order", () => {
  const txns = [
    mkTxn({ date: "2026-03-01", symbol: "JKH", type: "BUY", quantity: 50, price: 200 }, 2), // entered first
    mkTxn({ date: "2026-01-01", symbol: "JKH", type: "BUY", quantity: 100, price: 100, fee: 0 }, 1), // backdated, entered second
  ];
  const r = Calc.replaySymbol(txns);
  assert.strictEqual(r.qty, 150);
  // avg cost should reflect Jan buy processed BEFORE March buy regardless of array order
  const janFee = Calc.computeFee(50, 200, 0.0065);
  const expected = Calc.round2((100 * 100 + (50 * 200 + janFee)) / 150);
  assert.strictEqual(r.avgCost, expected);
});

// stop loss / target status
test("stop loss and target status classify correctly", () => {
  const holdings = [{ symbol: "JKH", avgBuyPrice: 100, currentPrice: 80 }];
  const targets = [{ symbol: "JKH", stopLossPct: 0.1, targetPct: 0.2 }];
  const rows = Calc.computeStopLossTargets(holdings, targets);
  assert.strictEqual(rows[0].status, "STOP LOSS HIT");

  holdings[0].currentPrice = 125;
  const rows2 = Calc.computeStopLossTargets(holdings, targets);
  assert.strictEqual(rows2[0].status, "TARGET HIT");

  holdings[0].currentPrice = 100;
  const rows3 = Calc.computeStopLossTargets(holdings, targets);
  assert.strictEqual(rows3[0].status, "HOLD");
});

// sector summary aggregation
test("sector summary sums market value per sector and drops empty sectors", () => {
  const holdings = [
    { sector: "Banks", marketValue: 1000 },
    { sector: "Banks", marketValue: 500 },
    { sector: "Energy", marketValue: 300 },
  ];
  const summary = Calc.computeSectorSummary(holdings);
  assert.strictEqual(summary.length, 2);
  assert.strictEqual(summary[0].sector, "Banks");
  assert.strictEqual(summary[0].marketValue, 1500);
});

// projections all use the same base (bug fix vs. original workbook)
test("projections use current value consistently for all horizons", () => {
  const p = Calc.computeProjections(100000, 0.12);
  assert.strictEqual(p.threeMonth, Calc.round2(100000 * Math.pow(1.12, 0.25)));
  assert.strictEqual(p.sixMonth, Calc.round2(100000 * Math.pow(1.12, 0.5)));
  assert.strictEqual(p.oneYear, Calc.round2(100000 * 1.12));
});

test("dashboard aggregates invested, value, P/L and return % without NaN/Infinity", () => {
  const dash = Calc.computeDashboard({
    holdings: [],
    totalCostBasis: 0,
    totalMarketValue: 0,
    totalRealizedPL: 0,
    cashFlow: { cashBalance: 0, netDividends: 0 },
    expectedAnnualReturnPct: 0,
  });
  assert.strictEqual(dash.totalReturnPct, 0);
  assert.ok(Number.isFinite(dash.totalPL));
});

console.log(`\n${passed} test(s) passed.`);
