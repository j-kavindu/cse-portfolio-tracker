/*
 * demo.js — sample data for the "Load Demo Data" action. None of this is
 * shipped as default/production data; it is only written when the user
 * explicitly asks for it from Settings.
 */
(function (global) {
  "use strict";

  function buildDemoData() {
    const instruments = [
      { symbol: "JKH", companyName: "John Keells Holdings PLC", sector: "Consumer Discretionary Distribution & Retail", currentPrice: 195.0 },
      { symbol: "COMB", companyName: "Commercial Bank of Ceylon PLC", sector: "Banks", currentPrice: 118.5 },
      { symbol: "LOLC", companyName: "LOLC Holdings PLC", sector: "Financial Services", currentPrice: 620.0 },
      { symbol: "DIAL", companyName: "Dialog Axiata PLC", sector: "Communication Services", currentPrice: 16.2 },
      { symbol: "HNB", companyName: "Hatton National Bank PLC", sector: "Banks", currentPrice: 285.0 },
    ];

    const brokeragePct = 0.0065;
    const fee = (q, p) => Math.round(q * p * brokeragePct * 100) / 100;

    let id = 1;
    const transactions = [
      { id: id++, date: "2025-02-10", symbol: "JKH", type: "BUY", quantity: 200, price: 160.0, fee: fee(200, 160.0) },
      { id: id++, date: "2025-04-18", symbol: "JKH", type: "BUY", quantity: 100, price: 175.0, fee: fee(100, 175.0) },
      { id: id++, date: "2025-09-02", symbol: "JKH", type: "SELL", quantity: 100, price: 190.0, fee: fee(100, 190.0) },
      { id: id++, date: "2025-03-05", symbol: "COMB", type: "BUY", quantity: 300, price: 105.0, fee: fee(300, 105.0) },
      { id: id++, date: "2025-11-20", symbol: "COMB", type: "BUY", quantity: 150, price: 112.0, fee: fee(150, 112.0) },
      { id: id++, date: "2025-05-14", symbol: "LOLC", type: "BUY", quantity: 40, price: 540.0, fee: fee(40, 540.0) },
      { id: id++, date: "2025-08-01", symbol: "DIAL", type: "BUY", quantity: 1000, price: 14.0, fee: fee(1000, 14.0) },
      { id: id++, date: "2025-12-15", symbol: "DIAL", type: "SELL", quantity: 400, price: 16.8, fee: fee(400, 16.8) },
      { id: id++, date: "2026-01-20", symbol: "HNB", type: "BUY", quantity: 60, price: 260.0, fee: fee(60, 260.0) },
    ];

    const dividends = [
      { id: 1, symbol: "COMB", recordDate: "2025-09-01", dividendPerShare: 4.5, paymentDate: "2025-09-25", taxRatePct: 0.15 },
      { id: 2, symbol: "JKH", recordDate: "2025-11-10", dividendPerShare: 3.0, paymentDate: "2025-12-01", taxRatePct: 0.15 },
    ];

    const cashAdjustments = [{ id: 1, date: "2025-02-01", amount: 500000, note: "Initial capital deposit" }];

    const targets = [
      { symbol: "JKH", stopLossPct: 0.1, targetPct: 0.25 },
      { symbol: "COMB", stopLossPct: 0.12, targetPct: 0.2 },
      { symbol: "LOLC", stopLossPct: 0.15, targetPct: 0.3 },
    ];

    const portfolioHistory = [
      { id: 1, date: "2025-03-01", value: 52000 },
      { id: 2, date: "2025-06-01", value: 96500 },
      { id: 3, date: "2025-09-01", value: 121000 },
      { id: 4, date: "2025-12-01", value: 138750 },
      { id: 5, date: "2026-03-01", value: 152300 },
    ];

    const settings = [
      { key: "brokerageFeePct", value: 0.0065 },
      { key: "dividendTaxPct", value: 0.15 },
      { key: "expectedAnnualReturnPct", value: 0.12 },
    ];

    return { transactions, instruments, dividends, cashAdjustments, targets, portfolioHistory, settings };
  }

  global.Demo = { buildDemoData };
})(window);
