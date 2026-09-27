/*
 * calculator.js
 * Pure financial calculation logic for the CSE Portfolio Tracker.
 * No DOM access, no storage access — everything here is a pure function
 * of its inputs, which makes it independently testable (see /tests).
 */
(function (global) {
  "use strict";

  const SECTORS = [
    "Banks",
    "Capital Goods",
    "Commercial & Professional Services",
    "Communication Services",
    "Consumer Discretionary Distribution & Retail",
    "Consumer Durables & Apparel",
    "Consumer Services",
    "Consumer Staples Distribution & Retail",
    "Energy",
    "Equity Real Estate Investment Trusts",
    "Financial Services",
    "Food, Beverage & Tobacco",
    "Health Care Equipment & Services",
    "Household & Personal Products",
    "Insurance",
    "Materials",
    "Pharmaceuticals, Biotechnology & Life Sciences",
    "Real Estate Management & Development",
    "Software & Services",
    "Utilities",
    "Other / Uncategorized",
  ];

  const DEFAULTS = {
    brokerageFeePct: 0.0065, // 0.65% default brokerage — editable in Settings
    dividendTaxPct: 0.15, // 15% withholding tax on dividends — editable in Settings
    expectedAnnualReturnPct: 0, // used for projections only, 0 = no projection
  };

  function round2(n) {
    return Math.round((n + Number.EPSILON) * 100) / 100;
  }

  function isFiniteNumber(n) {
    return typeof n === "number" && Number.isFinite(n);
  }

  /**
   * Computes the fee and signed cash impact of a single transaction.
   * BUY  -> cash impact is negative (cash leaves the account): -(qty*price + fee)
   * SELL -> cash impact is positive (cash enters the account): +(qty*price - fee)
   *
   * NOTE ON THE SOURCE WORKBOOK: the original "Total Value" column applied
   * (qty*price + fee) to BOTH buys and sells, then negated the sell figure.
   * That means a sale's fee was effectively added to the outflow rather than
   * subtracted from the proceeds, and the Cash Flow sheet's
   * "SUMIF(Sell) - SUMIF(Buy)" then double-counted the sign, so cash balance
   * fell further with every sale instead of rising. This function implements
   * the corrected, standard convention (fee always reduces the party who pays
   * it) — see README "Corrections to the original workbook" for the full note.
   */
  function transactionCashImpact(txn) {
    const gross = txn.quantity * txn.price;
    const fee = txn.fee;
    if (txn.type === "BUY") {
      return -(gross + fee);
    }
    return gross - fee;
  }

  function computeFee(quantity, price, feePct) {
    return round2(quantity * price * feePct);
  }

  /**
   * Replays a symbol's transactions in chronological order using the
   * moving weighted-average-cost method:
   *  - BUY:  new avg cost = (old cost basis + buy cost) / (old qty + buy qty)
   *  - SELL: cost basis removed = sellQty * avgCostAtTimeOfSale
   *          realized P/L    = (sellQty*price - fee) - costRemoved
   *          avg cost is UNCHANGED by a sell (only buys move it)
   *
   * NOTE ON THE SOURCE WORKBOOK: the Holdings sheet computed "Total Cost" as
   * the sum of every historical BUY's total value for a symbol, without ever
   * reducing it when shares were sold. That leaves the cost basis of shares
   * that no longer exist still sitting in the total, so Unrealized P/L keeps
   * comparing the *current* market value against a *stale, oversized* cost
   * figure — a fully-exited position would show 100% of its original cost as
   * a "loss" even if it was sold at a profit. This function instead reduces
   * the cost basis proportionally on every sale and tracks realized P/L
   * separately, so the two figures stay financially correct after partial or
   * full exits. See README for the full note.
   *
   * Returns { qty, avgCost, costBasis, realizedPL, brokenAt } — brokenAt is
   * set to the offending transaction if a SELL is encountered that exceeds
   * the shares available at that point in history (e.g. after a backdated
   * edit). We never clamp or silently fix this; the caller surfaces it as a
   * validation warning instead.
   */
  function replaySymbol(transactions) {
    const sorted = [...transactions].sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      return (a.id || 0) - (b.id || 0);
    });

    let qty = 0;
    let costBasis = 0;
    let avgCost = 0;
    let realizedPL = 0;
    let brokenAt = null;

    for (const txn of sorted) {
      if (txn.type === "BUY") {
        const buyCost = txn.quantity * txn.price + txn.fee;
        costBasis += buyCost;
        qty += txn.quantity;
        avgCost = qty > 0 ? costBasis / qty : 0;
      } else {
        // SELL
        if (txn.quantity > qty + 1e-9 && !brokenAt) {
          brokenAt = txn;
        }
        const sellQty = Math.min(txn.quantity, qty);
        const costRemoved = sellQty * avgCost;
        const proceeds = sellQty * txn.price - txn.fee;
        realizedPL += proceeds - costRemoved;
        costBasis -= costRemoved;
        qty -= sellQty;
        if (qty < 1e-9) {
          qty = 0;
          costBasis = 0;
        }
      }
    }

    return { qty: round2(qty), avgCost: round2(avgCost), costBasis: round2(costBasis), realizedPL: round2(realizedPL), brokenAt };
  }

  /**
   * Builds the Holdings table (one row per symbol that has ever had a
   * transaction) plus a portfolio-wide realized P/L total and a list of any
   * transactions that broke chronological consistency (oversold at some
   * point in history).
   *
   * instruments: Map/array of { symbol, companyName, sector, currentPrice }
   */
  function buildHoldings(transactions, instruments) {
    const bySymbol = new Map();
    for (const t of transactions) {
      if (!bySymbol.has(t.symbol)) bySymbol.set(t.symbol, []);
      bySymbol.get(t.symbol).push(t);
    }

    const instrumentMap = new Map(instruments.map((i) => [i.symbol, i]));
    const holdings = [];
    let totalRealizedPL = 0;
    const brokenTransactions = [];

    for (const [symbol, txns] of bySymbol.entries()) {
      const replay = replaySymbol(txns);
      totalRealizedPL += replay.realizedPL;
      if (replay.brokenAt) brokenTransactions.push(replay.brokenAt);

      const instrument = instrumentMap.get(symbol) || {
        symbol,
        companyName: "",
        sector: "Other / Uncategorized",
        currentPrice: 0,
      };
      const currentPrice = isFiniteNumber(instrument.currentPrice) ? instrument.currentPrice : 0;
      const marketValue = round2(replay.qty * currentPrice);
      const unrealizedPL = round2(marketValue - replay.costBasis);
      const unrealizedPLPct = replay.costBasis === 0 ? 0 : unrealizedPL / replay.costBasis;

      // Only surface as a live holding if shares remain OR it still has an
      // open cost basis; fully-exited symbols are kept out of Holdings but
      // their realized P/L still counts toward the portfolio total above.
      if (replay.qty > 0) {
        holdings.push({
          symbol,
          companyName: instrument.companyName,
          sector: instrument.sector,
          quantity: replay.qty,
          avgBuyPrice: round2(replay.avgCost),
          costBasis: replay.costBasis,
          currentPrice,
          marketValue,
          unrealizedPL,
          unrealizedPLPct,
          weightPct: 0, // filled in below once total market value is known
        });
      }
    }

    const totalMarketValue = holdings.reduce((s, h) => s + h.marketValue, 0);
    for (const h of holdings) {
      h.weightPct = totalMarketValue === 0 ? 0 : h.marketValue / totalMarketValue;
    }

    holdings.sort((a, b) => a.symbol.localeCompare(b.symbol));

    return {
      holdings,
      totalRealizedPL: round2(totalRealizedPL),
      totalCostBasis: round2(holdings.reduce((s, h) => s + h.costBasis, 0)),
      totalMarketValue: round2(totalMarketValue),
      brokenTransactions,
    };
  }

  function computeSectorSummary(holdings) {
    const bySector = new Map(SECTORS.map((s) => [s, 0]));
    for (const h of holdings) {
      const sector = bySector.has(h.sector) ? h.sector : "Other / Uncategorized";
      bySector.set(sector, round2((bySector.get(sector) || 0) + h.marketValue));
    }
    return [...bySector.entries()]
      .map(([sector, marketValue]) => ({ sector, marketValue }))
      .filter((r) => r.marketValue > 0)
      .sort((a, b) => b.marketValue - a.marketValue);
  }

  /**
   * Net trading cash + net dividends + manual adjustments = cash balance.
   * See transactionCashImpact() for the corrected sign convention.
   */
  function computeCashFlow(transactions, dividendRows, cashAdjustments) {
    const netTradingCash = round2(transactions.reduce((s, t) => s + transactionCashImpact(t), 0));
    const netDividends = round2(dividendRows.reduce((s, d) => s + d.netDividend, 0));
    const netAdjustments = round2(cashAdjustments.reduce((s, a) => s + a.amount, 0));
    return {
      netTradingCash,
      netDividends,
      netAdjustments,
      cashBalance: round2(netTradingCash + netDividends + netAdjustments),
    };
  }

  /**
   * Dividend rows: shares held at record date = net BUY-minus-SELL quantity
   * for the symbol strictly BEFORE the record date (matches the original
   * workbook's "<" comparison).
   */
  function computeDividendRows(dividendEntries, transactions, taxRatePctDefault) {
    return dividendEntries.map((d) => {
      const relevant = transactions.filter((t) => t.symbol === d.symbol && t.date < d.recordDate);
      const sharesHeld = relevant.reduce((s, t) => s + (t.type === "BUY" ? t.quantity : -t.quantity), 0);
      const shares = Math.max(0, round2(sharesHeld));
      const grossDividend = round2(shares * d.dividendPerShare);
      const taxRate = isFiniteNumber(d.taxRatePct) ? d.taxRatePct : taxRatePctDefault;
      const netDividend = round2(grossDividend * (1 - taxRate));
      return { ...d, sharesHeld: shares, grossDividend, netDividend, taxRatePct: taxRate };
    });
  }

  function computeStopLossTargets(holdings, targetSettings) {
    const holdingsBySymbol = new Map(holdings.map((h) => [h.symbol, h]));
    return targetSettings
      .filter((t) => holdingsBySymbol.has(t.symbol))
      .map((t) => {
        const h = holdingsBySymbol.get(t.symbol);
        const stopLossPrice = round2(h.avgBuyPrice * (1 - t.stopLossPct));
        const targetPrice = round2(h.avgBuyPrice * (1 + t.targetPct));
        let status = "NO PRICE SET";
        if (h.currentPrice > 0) {
          if (h.currentPrice <= stopLossPrice) status = "STOP LOSS HIT";
          else if (h.currentPrice >= targetPrice) status = "TARGET HIT";
          else status = "HOLD";
        }
        return {
          symbol: t.symbol,
          avgBuyPrice: h.avgBuyPrice,
          currentPrice: h.currentPrice,
          stopLossPct: t.stopLossPct,
          stopLossPrice,
          targetPct: t.targetPct,
          targetPrice,
          status,
        };
      });
  }

  /**
   * Projections are always based on CURRENT PORTFOLIO VALUE.
   *
   * NOTE ON THE SOURCE WORKBOOK: its 3-month projection formula referenced
   * Total Invested (B4) while the 6-month and 1-year formulas referenced
   * Current Value (B5) — an inconsistent base that was very likely a copy
   * error in the original sheet. All three horizons are computed from the
   * same base value here.
   */
  function computeProjections(currentValue, expectedAnnualReturnPct) {
    if (!expectedAnnualReturnPct) {
      return { threeMonth: null, sixMonth: null, oneYear: null };
    }
    const grow = (months) => round2(currentValue * Math.pow(1 + expectedAnnualReturnPct, months / 12));
    return {
      threeMonth: grow(3),
      sixMonth: grow(6),
      oneYear: grow(12),
    };
  }

  function computeDashboard({ holdings, totalCostBasis, totalMarketValue, totalRealizedPL, cashFlow, expectedAnnualReturnPct }) {
    const unrealizedPL = round2(totalMarketValue - totalCostBasis);
    const totalPL = round2(unrealizedPL + totalRealizedPL);
    const totalReturnPct = totalCostBasis === 0 ? 0 : totalPL / totalCostBasis;
    const projections = computeProjections(totalMarketValue, expectedAnnualReturnPct);
    return {
      totalInvested: totalCostBasis,
      currentValue: totalMarketValue,
      unrealizedPL,
      realizedPL: totalRealizedPL,
      totalPL,
      totalReturnPct,
      cashBalance: cashFlow.cashBalance,
      dividendsReceived: cashFlow.netDividends,
      projections,
    };
  }

  /**
   * Validates a transaction BEFORE it is written to storage. Returns
   * { valid: true } or { valid: false, message }.
   * currentQuantity is the quantity already held in that symbol as of the
   * transaction's date (excluding the transaction being validated) — the
   * caller supplies this via replaySymbol on the existing data set.
   */
  function validateTransaction(txn, currentQuantityAtDate) {
    if (!txn.date) return { valid: false, message: "Date is required." };
    if (!txn.symbol || !txn.symbol.trim()) return { valid: false, message: "Stock symbol is required." };
    if (txn.type !== "BUY" && txn.type !== "SELL") return { valid: false, message: "Transaction type must be BUY or SELL." };
    if (!isFiniteNumber(txn.quantity) || txn.quantity <= 0) return { valid: false, message: "Quantity must be a positive number." };
    if (!Number.isInteger(txn.quantity)) return { valid: false, message: "Quantity must be a whole number of shares." };
    if (!isFiniteNumber(txn.price) || txn.price <= 0) return { valid: false, message: "Price must be a positive number." };
    if (!isFiniteNumber(txn.fee) || txn.fee < 0) return { valid: false, message: "Brokerage fee cannot be negative." };
    if (txn.type === "SELL" && txn.quantity > currentQuantityAtDate + 1e-9) {
      return {
        valid: false,
        message: `You only hold ${currentQuantityAtDate} share(s) of ${txn.symbol} as of this date — cannot sell ${txn.quantity}.`,
      };
    }
    const gross = txn.quantity * txn.price;
    if (!isFiniteNumber(gross) || !isFiniteNumber(gross + txn.fee)) {
      return { valid: false, message: "This transaction produces an invalid (NaN/Infinity) calculation." };
    }
    return { valid: true };
  }

  function validateDividend(entry) {
    if (!entry.symbol || !entry.symbol.trim()) return { valid: false, message: "Stock symbol is required." };
    if (!entry.recordDate) return { valid: false, message: "Record date is required." };
    if (!isFiniteNumber(entry.dividendPerShare) || entry.dividendPerShare <= 0) {
      return { valid: false, message: "Dividend per share must be a positive number." };
    }
    if (entry.taxRatePct != null && (entry.taxRatePct < 0 || entry.taxRatePct >= 1)) {
      return { valid: false, message: "Tax rate must be between 0% and 100%." };
    }
    return { valid: true };
  }

  const Calc = {
    SECTORS,
    DEFAULTS,
    round2,
    isFiniteNumber,
    computeFee,
    transactionCashImpact,
    replaySymbol,
    buildHoldings,
    computeSectorSummary,
    computeCashFlow,
    computeDividendRows,
    computeStopLossTargets,
    computeProjections,
    computeDashboard,
    validateTransaction,
    validateDividend,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = Calc;
  } else {
    global.Calc = Calc;
  }
})(typeof window !== "undefined" ? window : globalThis);
