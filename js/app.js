/* app.js — application shell, routing, rendering and event handling. */
(function () {
  "use strict";

  const $app = document.getElementById("app");
  const $toast = document.getElementById("toast");

  let state = {
    transactions: [],
    instruments: [],
    dividends: [],
    cashAdjustments: [],
    targets: [],
    portfolioHistory: [],
    settings: { brokerageFeePct: Calc.DEFAULTS.brokerageFeePct, dividendTaxPct: Calc.DEFAULTS.dividendTaxPct, expectedAnnualReturnPct: Calc.DEFAULTS.expectedAnnualReturnPct },
  };

  let derived = null; // recomputed by recompute()

  // ---------- utilities ----------
  function fmt(n, opts) {
    opts = opts || {};
    if (n === null || n === undefined || Number.isNaN(n)) return "—";
    const sign = n < 0 ? "-" : "";
    const abs = Math.abs(n);
    const str = abs.toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return `${sign}${opts.noCurrency ? "" : "Rs. "}${str}`;
  }
  function fmtPct(n) {
    if (n === null || n === undefined || Number.isNaN(n)) return "—";
    return (n * 100).toFixed(2) + "%";
  }
  function plClass(n) {
    if (n === null || n === undefined || Number.isNaN(n)) return "";
    return n > 0 ? "pl-positive" : n < 0 ? "pl-negative" : "pl-neutral";
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function todayISO() {
    return new Date().toISOString().slice(0, 10);
  }
  function showToast(message, isError) {
    $toast.textContent = message;
    $toast.className = "toast show" + (isError ? " toast-error" : "");
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => $toast.classList.remove("show"), 3200);
  }
  function uid() {
    return Date.now() + Math.floor(Math.random() * 1000);
  }

  // ---------- data load / recompute ----------
  async function loadAll() {
    const data = await DB.getAllData();
    state.transactions = data.transactions || [];
    state.instruments = data.instruments || [];
    state.dividends = data.dividends || [];
    state.cashAdjustments = data.cashAdjustments || [];
    state.targets = data.targets || [];
    state.portfolioHistory = (data.portfolioHistory || []).sort((a, b) => (a.date < b.date ? -1 : 1));
    const settingsRows = data.settings || [];
    for (const row of settingsRows) state.settings[row.key] = row.value;
    recompute();
  }

  function recompute() {
    const built = Calc.buildHoldings(state.transactions, state.instruments);
    const dividendRows = Calc.computeDividendRows(state.dividends, state.transactions, state.settings.dividendTaxPct);
    const cashFlow = Calc.computeCashFlow(state.transactions, dividendRows, state.cashAdjustments);
    const dashboard = Calc.computeDashboard({
      holdings: built.holdings,
      totalCostBasis: built.totalCostBasis,
      totalMarketValue: built.totalMarketValue,
      totalRealizedPL: built.totalRealizedPL,
      cashFlow,
      expectedAnnualReturnPct: state.settings.expectedAnnualReturnPct,
    });
    const sectorSummary = Calc.computeSectorSummary(built.holdings);
    const stopLossTargets = Calc.computeStopLossTargets(built.holdings, state.targets);
    derived = { ...built, dividendRows, cashFlow, dashboard, sectorSummary, stopLossTargets };
  }

  /** quantity of `symbol` held just before/at the insertion point of a candidate txn (for validation) */
  function quantityBeforeInsertion(symbol, candidate, excludeId) {
    const others = state.transactions.filter((t) => t.symbol === symbol && t.id !== excludeId);
    const sorted = [...others].sort((a, b) => (a.date !== b.date ? (a.date < b.date ? -1 : 1) : (a.id || 0) - (b.id || 0)));
    let qty = 0;
    for (const t of sorted) {
      const before = t.date < candidate.date || (t.date === candidate.date && (t.id || 0) < (candidate.id || Infinity));
      if (!before) break;
      qty += t.type === "BUY" ? t.quantity : -t.quantity;
    }
    return Math.max(0, Calc.round2(qty));
  }

  function instrumentFor(symbol) {
    return state.instruments.find((i) => i.symbol === symbol);
  }

  // ---------- routing ----------
  const ROUTES = {
    dashboard: renderDashboard,
    transactions: renderTransactions,
    holdings: renderHoldings,
    dividends: renderDividends,
    targets: renderTargets,
    cashflow: renderCashFlow,
    settings: renderSettings,
  };

  function currentRoute() {
    const h = (location.hash || "#/dashboard").replace("#/", "");
    return ROUTES[h] ? h : "dashboard";
  }

  function navigate() {
    if (document.getElementById("app-shell").hidden) return;
    const route = currentRoute();
    document.querySelectorAll(".nav-link").forEach((a) => a.classList.toggle("active", a.dataset.route === route));
    document.getElementById("more-nav").classList.toggle("active", ["dividends", "targets", "cashflow", "settings"].includes(route));
    closeMoreMenu();
    ROUTES[route]();
    $app.querySelector("h1")?.focus();
  }

  const moreButton = document.getElementById("more-nav");
  const moreMenu = document.getElementById("more-menu");
  function closeMoreMenu() {
    moreMenu.hidden = true;
    moreButton.setAttribute("aria-expanded", "false");
  }
  moreButton.addEventListener("click", () => {
    moreMenu.hidden = !moreMenu.hidden;
    moreButton.setAttribute("aria-expanded", String(!moreMenu.hidden));
  });
  moreMenu.addEventListener("click", (event) => { if (event.target.closest("a")) closeMoreMenu(); });
  document.addEventListener("click", (event) => {
    if (!moreMenu.hidden && !moreMenu.contains(event.target) && !moreButton.contains(event.target)) closeMoreMenu();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !moreMenu.hidden) { closeMoreMenu(); moreButton.focus(); }
  });

  window.addEventListener("hashchange", navigate);

  // ---------- shared bits ----------
  function pageHeader(title, subtitle) {
    return `<div class="page-header"><h1 tabindex="-1">${esc(title)}</h1>${subtitle ? `<p class="page-subtitle">${subtitle}</p>` : ""}</div>`;
  }

  function emptyState(message, actionHtml) {
    return `<div class="empty-state"><p>${esc(message)}</p>${actionHtml || ""}</div>`;
  }

  function warningBanner() {
    if (!derived.brokenTransactions.length) return "";
    const list = derived.brokenTransactions.map((t) => `${esc(t.symbol)} on ${esc(t.date)} (sold ${t.quantity})`).join(", ");
    return `<div class="banner banner-warning">
      <strong>Data consistency warning:</strong> the following sell transactions exceed the shares held at that point in
      history — likely caused by an edited or backdated entry: ${list}. Quantities were floored at zero rather than
      silently corrected; please review these transactions.
    </div>`;
  }

  // ---------- Dashboard ----------
  function renderDashboard() {
    const d = derived.dashboard;
    const kpis = [
      { label: "Total Invested (Cost Basis)", value: fmt(d.totalInvested) },
      { label: "Current Value", value: fmt(d.currentValue) },
      { label: "Unrealized P/L", value: fmt(d.unrealizedPL), cls: plClass(d.unrealizedPL) },
      { label: "Realized P/L", value: fmt(d.realizedPL), cls: plClass(d.realizedPL) },
      { label: "Total P/L", value: fmt(d.totalPL), cls: plClass(d.totalPL) },
      { label: "Total Return %", value: fmtPct(d.totalReturnPct), cls: plClass(d.totalReturnPct) },
      { label: "Cash Balance", value: fmt(d.cashBalance) },
      { label: "Dividends Received (Net)", value: fmt(d.dividendsReceived) },
    ];

    const growthPoints = state.portfolioHistory.map((h) => ({ label: h.date.slice(5), value: h.value }));
    const sectorSlices = derived.sectorSummary.map((s) => ({ label: s.sector, value: s.marketValue }));
    const kpiBars = [
      { label: "Invested", value: d.totalInvested, tone: "neutral" },
      { label: "Value", value: d.currentValue, tone: "neutral" },
      { label: "Total P/L", value: d.totalPL },
    ];
    const projBars = d.projections.threeMonth == null
      ? []
      : [
          { label: "3M", value: d.projections.threeMonth, tone: "neutral" },
          { label: "6M", value: d.projections.sixMonth, tone: "neutral" },
          { label: "1Y", value: d.projections.oneYear, tone: "neutral" },
        ];

    $app.innerHTML = `
      ${pageHeader("Portfolio Dashboard", "All prices are manually entered — this is not a live market data feed.")}
      ${warningBanner()}
      <div class="kpi-grid">
        ${kpis.map((k) => `<div class="kpi-card"><div class="kpi-label">${k.label}</div><div class="kpi-value ${k.cls || ""}">${k.value}</div></div>`).join("")}
      </div>
      <div class="chart-grid">
        <section class="chart-card chart-card-wide">
          <div class="chart-card-head">
            <h2>Portfolio Growth</h2>
            <button class="btn btn-secondary btn-sm" data-action="log-snapshot">Log today's value</button>
          </div>
          ${Charts.lineChart(growthPoints, { width: 640, height: 240 })}
        </section>
        <section class="chart-card">
          <h2>Sector Allocation</h2>
          <div class="donut-row">
            ${Charts.donutChart(sectorSlices, { size: 180 })}
            <div class="legend">${Charts.donutLegend(sectorSlices)}</div>
          </div>
        </section>
        <section class="chart-card">
          <h2>Invested vs. Value vs. P/L</h2>
          ${Charts.barChart(kpiBars, { width: 380, height: 220 })}
        </section>
        <section class="chart-card">
          <div class="chart-card-head">
            <h2>Future Projection</h2>
          </div>
          <form class="inline-form" data-form="expected-return">
            <label>Expected annual return
              <input type="number" step="0.1" name="expectedAnnualReturnPct" value="${(state.settings.expectedAnnualReturnPct * 100).toFixed(1)}" />%
            </label>
            <button class="btn btn-secondary btn-sm" type="submit">Update</button>
          </form>
          ${d.projections.threeMonth == null ? emptyState("Set an expected annual return above to see 3/6/12-month projections of your current portfolio value.") : Charts.barChart(projBars, { width: 380, height: 200 })}
        </section>
      </div>
    `;

    $app.querySelector('[data-action="log-snapshot"]').addEventListener("click", async () => {
      await DB.put("portfolioHistory", { id: uid(), date: todayISO(), value: derived.totalMarketValue });
      await loadAll();
      renderDashboard();
      showToast("Snapshot logged.");
    });

    $app.querySelector('[data-form="expected-return"]').addEventListener("submit", async (e) => {
      e.preventDefault();
      const pct = parseFloat(new FormData(e.target).get("expectedAnnualReturnPct")) / 100;
      state.settings.expectedAnnualReturnPct = Number.isFinite(pct) ? pct : 0;
      await DB.setSetting("expectedAnnualReturnPct", state.settings.expectedAnnualReturnPct);
      recompute();
      renderDashboard();
      showToast("Projection assumption updated.");
    });
  }

  // ---------- Transactions ----------
  let txnFormState = null; // { editingId } or null when closed

  function renderTransactions() {
    const rows = [...state.transactions].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (b.id || 0) - (a.id || 0)));
    $app.innerHTML = `
      ${pageHeader("Transactions", "Every BUY and SELL that drives your Holdings, Cash Flow, and P/L.")}
      <div class="toolbar">
        <button class="btn btn-primary" data-action="add-transaction">Add transaction</button>
      </div>
      <div id="txn-form-slot"></div>
      ${
        rows.length === 0
          ? emptyState("No transactions yet. Add your first BUY to start tracking a holding.")
          : `<div class="table-scroll"><table class="data-table">
        <thead><tr><th>Date</th><th>Symbol</th><th>Type</th><th class="num">Qty</th><th class="num">Price</th><th class="num">Fee</th><th class="num">Cash Impact</th><th></th></tr></thead>
        <tbody>
          ${rows
            .map((t) => {
              const impact = Calc.transactionCashImpact(t);
              return `<tr>
              <td>${esc(t.date)}</td>
              <td>${esc(t.symbol)}</td>
              <td><span class="tag tag-${t.type === "BUY" ? "buy" : "sell"}">${t.type}</span></td>
              <td class="num">${t.quantity.toLocaleString()}</td>
              <td class="num">${fmt(t.price, { noCurrency: true })}</td>
              <td class="num">${fmt(t.fee, { noCurrency: true })}</td>
              <td class="num ${plClass(impact)}">${fmt(impact)}</td>
              <td class="row-actions">
                <button class="icon-btn" data-action="edit-txn" data-id="${t.id}" aria-label="Edit">Edit</button>
                <button class="icon-btn icon-btn-danger" data-action="delete-txn" data-id="${t.id}" aria-label="Delete">Delete</button>
              </td>
            </tr>`;
            })
            .join("")}
        </tbody>
      </table></div>`
      }
    `;

    $app.querySelector('[data-action="add-transaction"]').addEventListener("click", () => {
      txnFormState = { editingId: null };
      renderTxnForm();
    });
    $app.querySelectorAll('[data-action="edit-txn"]').forEach((btn) =>
      btn.addEventListener("click", () => {
        txnFormState = { editingId: Number(btn.dataset.id) };
        renderTxnForm();
      })
    );
    $app.querySelectorAll('[data-action="delete-txn"]').forEach((btn) =>
      btn.addEventListener("click", async () => {
        const id = Number(btn.dataset.id);
        const t = state.transactions.find((x) => x.id === id);
        if (!confirm(`Delete the ${t.type} of ${t.quantity} ${t.symbol} on ${t.date}? This cannot be undone.`)) return;
        await DB.remove("transactions", id);
        await loadAll();
        renderTransactions();
        showToast("Transaction deleted.");
      })
    );

    if (txnFormState) renderTxnForm();
  }

  function renderTxnForm() {
    const editing = txnFormState.editingId ? state.transactions.find((t) => t.id === txnFormState.editingId) : null;
    const symbols = [...new Set(state.instruments.map((i) => i.symbol))];
    const slot = document.getElementById("txn-form-slot");
    slot.innerHTML = `
      <form class="panel-form" data-form="transaction">
        <h2>${editing ? "Edit" : "Add"} transaction</h2>
        <div class="form-grid">
          <label>Date<input type="date" name="date" required value="${esc(editing ? editing.date : todayISO())}" max="${todayISO()}"/></label>
          <label>Stock symbol<input list="symbol-list" name="symbol" required value="${esc(editing ? editing.symbol : "")}" placeholder="e.g. JKH" style="text-transform:uppercase"/>
            <datalist id="symbol-list">${symbols.map((s) => `<option value="${esc(s)}">`).join("")}</datalist>
          </label>
          <label>Type<select name="type" required>
            <option value="BUY" ${editing?.type === "BUY" ? "selected" : ""}>BUY</option>
            <option value="SELL" ${editing?.type === "SELL" ? "selected" : ""}>SELL</option>
          </select></label>
          <label>Quantity<input type="number" name="quantity" min="1" step="1" required value="${editing ? editing.quantity : ""}"/></label>
          <label>Price (LKR)<input type="number" name="price" min="0.01" step="0.01" required value="${editing ? editing.price : ""}"/></label>
          <label>Brokerage %<input type="number" name="brokeragePct" min="0" step="0.01" value="${((editing ? undefined : state.settings.brokerageFeePct) ?? state.settings.brokerageFeePct) * 100}"/></label>
        </div>
        <div class="new-symbol-fields" hidden>
          <p class="hint">New symbol — add its details so it appears correctly in Holdings and Sector Allocation.</p>
          <div class="form-grid">
            <label>Company name<input type="text" name="companyName" /></label>
            <label>Sector<select name="sector">${Calc.SECTORS.map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join("")}</select></label>
            <label>Current price (LKR)<input type="number" name="currentPrice" min="0" step="0.01" /></label>
          </div>
        </div>
        <p class="calc-preview" data-preview></p>
        <p class="form-error" data-error hidden></p>
        <div class="form-actions">
          <button type="submit" class="btn btn-primary">Save transaction</button>
          <button type="button" class="btn btn-secondary" data-action="cancel-txn">Cancel</button>
          ${editing ? `<input type="hidden" name="id" value="${editing.id}"/>` : ""}
        </div>
      </form>
    `;

    const form = slot.querySelector('[data-form="transaction"]');
    const symbolInput = form.symbol;
    const newFields = form.querySelector(".new-symbol-fields");
    function toggleNewFields() {
      const sym = symbolInput.value.trim().toUpperCase();
      const known = symbols.includes(sym);
      newFields.hidden = !sym || known;
    }
    symbolInput.addEventListener("input", toggleNewFields);
    toggleNewFields();

    function updatePreview() {
      const qty = parseFloat(form.quantity.value);
      const price = parseFloat(form.price.value);
      const pct = parseFloat(form.brokeragePct.value) / 100;
      const preview = form.querySelector("[data-preview]");
      if (!qty || !price || Number.isNaN(pct)) {
        preview.textContent = "";
        return;
      }
      const fee = Calc.computeFee(qty, price, pct);
      const impact = form.type.value === "BUY" ? -(qty * price + fee) : qty * price - fee;
      preview.textContent = `Brokerage fee: ${fmt(fee)}  ·  Cash impact: ${fmt(impact)}`;
    }
    ["quantity", "price", "brokeragePct", "type"].forEach((n) => form[n].addEventListener("input", updatePreview));
    updatePreview();

    form.querySelector('[data-action="cancel-txn"]').addEventListener("click", () => {
      txnFormState = null;
      renderTransactions();
    });

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const symbol = String(fd.get("symbol")).trim().toUpperCase();
      const pct = parseFloat(fd.get("brokeragePct")) / 100;
      const quantity = parseInt(fd.get("quantity"), 10);
      const price = parseFloat(fd.get("price"));
      const fee = Calc.isFiniteNumber(pct) ? Calc.computeFee(quantity, price, pct) : 0;
      const candidate = {
        id: editing ? editing.id : undefined,
        date: fd.get("date"),
        symbol,
        type: fd.get("type"),
        quantity,
        price,
        fee,
      };

      const errorEl = form.querySelector("[data-error]");
      const heldQty = quantityBeforeInsertion(symbol, candidate, editing ? editing.id : null);
      const validation = Calc.validateTransaction(candidate, heldQty);
      if (!validation.valid) {
        errorEl.hidden = false;
        errorEl.textContent = validation.message;
        return;
      }
      errorEl.hidden = true;

      if (!newFields.hidden) {
        await DB.put("instruments", {
          symbol,
          companyName: fd.get("companyName") || symbol,
          sector: fd.get("sector") || "Other / Uncategorized",
          currentPrice: parseFloat(fd.get("currentPrice")) || 0,
        });
      }

      await DB.put("transactions", { ...candidate, id: candidate.id || uid() });
      txnFormState = null;
      await loadAll();
      renderTransactions();
      showToast(editing ? "Transaction updated." : "Transaction added.");
    });
  }

  // ---------- Holdings ----------
  function renderHoldings() {
    const holdings = derived.holdings;
    $app.innerHTML = `
      ${pageHeader("Holdings", "Computed automatically from your Transactions. Update the current price to refresh valuations.")}
      ${warningBanner()}
      <div class="toolbar">
        <button class="btn btn-primary" data-action="add-instrument">Add / edit instrument details</button>
      </div>
      <div id="instrument-form-slot"></div>
      ${
        holdings.length === 0
          ? emptyState("No open holdings yet. Add a BUY transaction to get started.")
          : `<div class="table-scroll"><table class="data-table">
        <thead><tr><th>Symbol</th><th>Company</th><th>Sector</th><th class="num">Qty</th><th class="num">Avg Cost</th><th class="num">Cost Basis</th><th class="num">Current Price</th><th class="num">Market Value</th><th class="num">Unrealized P/L</th><th class="num">P/L %</th><th class="num">Weight</th></tr></thead>
        <tbody>
          ${holdings
            .map(
              (h) => `<tr>
              <td><strong>${esc(h.symbol)}</strong></td>
              <td>${esc(h.companyName)}</td>
              <td>${esc(h.sector)}</td>
              <td class="num">${h.quantity.toLocaleString()}</td>
              <td class="num">${fmt(h.avgBuyPrice, { noCurrency: true })}</td>
              <td class="num">${fmt(h.costBasis)}</td>
              <td class="num"><input type="number" class="price-input" step="0.01" min="0" data-symbol="${esc(h.symbol)}" value="${h.currentPrice}"/></td>
              <td class="num">${fmt(h.marketValue)}</td>
              <td class="num ${plClass(h.unrealizedPL)}">${fmt(h.unrealizedPL)}</td>
              <td class="num ${plClass(h.unrealizedPLPct)}">${fmtPct(h.unrealizedPLPct)}</td>
              <td class="num">${fmtPct(h.weightPct)}</td>
            </tr>`
            )
            .join("")}
        </tbody>
      </table></div>`
      }
    `;

    $app.querySelectorAll(".price-input").forEach((input) => {
      input.addEventListener("change", async () => {
        const symbol = input.dataset.symbol;
        const instrument = instrumentFor(symbol) || { symbol, companyName: symbol, sector: "Other / Uncategorized" };
        const price = parseFloat(input.value);
        if (!Calc.isFiniteNumber(price) || price < 0) {
          showToast("Price must be a non-negative number.", true);
          input.value = instrument.currentPrice || 0;
          return;
        }
        await DB.put("instruments", { ...instrument, currentPrice: price });
        await loadAll();
        renderHoldings();
        showToast(`${symbol} price updated.`);
      });
    });

    $app.querySelector('[data-action="add-instrument"]').addEventListener("click", renderInstrumentForm);
  }

  function renderInstrumentForm() {
    const slot = document.getElementById("instrument-form-slot");
    slot.innerHTML = `
      <form class="panel-form" data-form="instrument">
        <h2>Add / edit instrument details</h2>
        <div class="form-grid">
          <label>Stock symbol<input list="all-symbols" name="symbol" required style="text-transform:uppercase"/>
            <datalist id="all-symbols">${state.instruments.map((i) => `<option value="${esc(i.symbol)}">`).join("")}</datalist>
          </label>
          <label>Company name<input type="text" name="companyName" /></label>
          <label>Sector<select name="sector">${Calc.SECTORS.map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join("")}</select></label>
          <label>Current price (LKR)<input type="number" name="currentPrice" min="0" step="0.01" /></label>
        </div>
        <div class="form-actions">
          <button type="submit" class="btn btn-primary">Save</button>
          <button type="button" class="btn btn-secondary" data-action="cancel">Cancel</button>
        </div>
      </form>`;
    const form = slot.querySelector("form");
    form.symbol.addEventListener("change", () => {
      const existing = instrumentFor(form.symbol.value.trim().toUpperCase());
      if (existing) {
        form.companyName.value = existing.companyName || "";
        form.sector.value = existing.sector || Calc.SECTORS[Calc.SECTORS.length - 1];
        form.currentPrice.value = existing.currentPrice || 0;
      }
    });
    form.querySelector('[data-action="cancel"]').addEventListener("click", () => (slot.innerHTML = ""));
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const symbol = String(fd.get("symbol")).trim().toUpperCase();
      if (!symbol) return showToast("Symbol is required.", true);
      await DB.put("instruments", {
        symbol,
        companyName: fd.get("companyName") || symbol,
        sector: fd.get("sector"),
        currentPrice: parseFloat(fd.get("currentPrice")) || 0,
      });
      slot.innerHTML = "";
      await loadAll();
      renderHoldings();
      showToast("Instrument saved.");
    });
  }

  // ---------- Dividends ----------
  let divFormOpen = false;

  function renderDividends() {
    const rows = [...derived.dividendRows].sort((a, b) => (a.recordDate < b.recordDate ? 1 : -1));
    $app.innerHTML = `
      ${pageHeader("Dividends", "Shares held are computed from Transactions as of each record date.")}
      <div class="toolbar"><button class="btn btn-primary" data-action="add-dividend">Add dividend</button></div>
      <div id="dividend-form-slot"></div>
      ${
        rows.length === 0
          ? emptyState("No dividends recorded yet.")
          : `<div class="table-scroll"><table class="data-table">
        <thead><tr><th>Symbol</th><th>Record Date</th><th class="num">Div/Share</th><th class="num">Shares Held</th><th class="num">Gross</th><th class="num">Tax %</th><th class="num">Net</th><th>Payment Date</th><th></th></tr></thead>
        <tbody>
          ${rows
            .map(
              (d) => `<tr>
              <td><strong>${esc(d.symbol)}</strong></td>
              <td>${esc(d.recordDate)}</td>
              <td class="num">${fmt(d.dividendPerShare, { noCurrency: true })}</td>
              <td class="num">${d.sharesHeld.toLocaleString()}</td>
              <td class="num">${fmt(d.grossDividend)}</td>
              <td class="num">${fmtPct(d.taxRatePct)}</td>
              <td class="num pl-positive">${fmt(d.netDividend)}</td>
              <td>${esc(d.paymentDate || "—")}</td>
              <td class="row-actions"><button class="icon-btn icon-btn-danger" data-action="delete-div" data-id="${d.id}">Delete</button></td>
            </tr>`
            )
            .join("")}
        </tbody>
      </table></div>`
      }
    `;
    $app.querySelector('[data-action="add-dividend"]').addEventListener("click", () => {
      divFormOpen = true;
      renderDividendForm();
    });
    $app.querySelectorAll('[data-action="delete-div"]').forEach((btn) =>
      btn.addEventListener("click", async () => {
        if (!confirm("Delete this dividend record?")) return;
        await DB.remove("dividends", Number(btn.dataset.id));
        await loadAll();
        renderDividends();
        showToast("Dividend deleted.");
      })
    );
  }

  function renderDividendForm() {
    const symbols = [...new Set(state.instruments.map((i) => i.symbol))];
    const slot = document.getElementById("dividend-form-slot");
    slot.innerHTML = `
      <form class="panel-form" data-form="dividend">
        <h2>Add dividend</h2>
        <div class="form-grid">
          <label>Stock symbol<input list="div-symbol-list" name="symbol" required style="text-transform:uppercase"/>
            <datalist id="div-symbol-list">${symbols.map((s) => `<option value="${esc(s)}">`).join("")}</datalist>
          </label>
          <label>Record date<input type="date" name="recordDate" required max="${todayISO()}"/></label>
          <label>Dividend per share (LKR)<input type="number" name="dividendPerShare" min="0.01" step="0.01" required/></label>
          <label>Payment date<input type="date" name="paymentDate"/></label>
          <label>Tax rate %<input type="number" name="taxRatePct" min="0" max="99" step="0.1" value="${(state.settings.dividendTaxPct * 100).toFixed(1)}"/></label>
        </div>
        <p class="form-error" data-error hidden></p>
        <div class="form-actions">
          <button type="submit" class="btn btn-primary">Save</button>
          <button type="button" class="btn btn-secondary" data-action="cancel">Cancel</button>
        </div>
      </form>`;
    const form = slot.querySelector("form");
    form.querySelector('[data-action="cancel"]').addEventListener("click", () => {
      divFormOpen = false;
      slot.innerHTML = "";
    });
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const entry = {
        id: uid(),
        symbol: String(fd.get("symbol")).trim().toUpperCase(),
        recordDate: fd.get("recordDate"),
        dividendPerShare: parseFloat(fd.get("dividendPerShare")),
        paymentDate: fd.get("paymentDate") || "",
        taxRatePct: parseFloat(fd.get("taxRatePct")) / 100,
      };
      const validation = Calc.validateDividend(entry);
      const errorEl = form.querySelector("[data-error]");
      if (!validation.valid) {
        errorEl.hidden = false;
        errorEl.textContent = validation.message;
        return;
      }
      await DB.put("dividends", entry);
      divFormOpen = false;
      await loadAll();
      renderDividends();
      showToast("Dividend added.");
    });
  }

  // ---------- Stop Loss & Targets ----------
  function renderTargets() {
    const heldSymbols = derived.holdings.map((h) => h.symbol);
    const rows = derived.stopLossTargets;
    const untracked = heldSymbols.filter((s) => !state.targets.some((t) => t.symbol === s));
    $app.innerHTML = `
      ${pageHeader("Stop Loss & Targets", "Set a stop-loss and target percentage for each holding, based on its average buy price.")}
      ${
        untracked.length
          ? `<div class="banner banner-info">No targets set yet for: ${untracked.map(esc).join(", ")}. Add them below.</div>`
          : ""
      }
      <div class="toolbar"><button class="btn btn-primary" data-action="add-target">Set a target</button></div>
      <div id="target-form-slot"></div>
      ${
        rows.length === 0
          ? emptyState("No targets configured yet.")
          : `<div class="table-scroll"><table class="data-table">
        <thead><tr><th>Symbol</th><th class="num">Avg Buy</th><th class="num">Current</th><th class="num">Stop Loss %</th><th class="num">Stop Loss Price</th><th class="num">Target %</th><th class="num">Target Price</th><th>Status</th><th></th></tr></thead>
        <tbody>
          ${rows
            .map(
              (r) => `<tr>
              <td><strong>${esc(r.symbol)}</strong></td>
              <td class="num">${fmt(r.avgBuyPrice, { noCurrency: true })}</td>
              <td class="num">${fmt(r.currentPrice, { noCurrency: true })}</td>
              <td class="num">${fmtPct(r.stopLossPct)}</td>
              <td class="num">${fmt(r.stopLossPrice, { noCurrency: true })}</td>
              <td class="num">${fmtPct(r.targetPct)}</td>
              <td class="num">${fmt(r.targetPrice, { noCurrency: true })}</td>
              <td><span class="status-badge status-${r.status.replace(/\s+/g, "-").toLowerCase()}">${esc(r.status)}</span></td>
              <td class="row-actions"><button class="icon-btn" data-action="edit-target" data-symbol="${esc(r.symbol)}">Edit</button></td>
            </tr>`
            )
            .join("")}
        </tbody>
      </table></div>`
      }
    `;
    $app.querySelector('[data-action="add-target"]').addEventListener("click", () => renderTargetForm());
    $app.querySelectorAll('[data-action="edit-target"]').forEach((btn) => btn.addEventListener("click", () => renderTargetForm(btn.dataset.symbol)));
  }

  function renderTargetForm(editSymbol) {
    const slot = document.getElementById("target-form-slot");
    const existing = editSymbol ? state.targets.find((t) => t.symbol === editSymbol) : null;
    const heldSymbols = derived.holdings.map((h) => h.symbol);
    slot.innerHTML = `
      <form class="panel-form" data-form="target">
        <h2>${existing ? "Edit" : "Set"} target</h2>
        <div class="form-grid">
          <label>Stock symbol
            ${
              editSymbol
                ? `<input type="text" name="symbol" value="${esc(editSymbol)}" readonly/>`
                : `<select name="symbol" required>${heldSymbols.map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join("")}</select>`
            }
          </label>
          <label>Stop loss %<input type="number" name="stopLossPct" min="0" max="99" step="0.1" value="${existing ? existing.stopLossPct * 100 : 10}"/></label>
          <label>Target %<input type="number" name="targetPct" min="0" step="0.1" value="${existing ? existing.targetPct * 100 : 20}"/></label>
        </div>
        <div class="form-actions">
          <button type="submit" class="btn btn-primary">Save</button>
          <button type="button" class="btn btn-secondary" data-action="cancel">Cancel</button>
        </div>
      </form>`;
    const form = slot.querySelector("form");
    form.querySelector('[data-action="cancel"]').addEventListener("click", () => (slot.innerHTML = ""));
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      await DB.put("targets", {
        symbol: String(fd.get("symbol")).trim().toUpperCase(),
        stopLossPct: parseFloat(fd.get("stopLossPct")) / 100,
        targetPct: parseFloat(fd.get("targetPct")) / 100,
      });
      slot.innerHTML = "";
      await loadAll();
      renderTargets();
      showToast("Target saved.");
    });
  }

  // ---------- Cash Flow ----------
  function renderCashFlow() {
    const cf = derived.cashFlow;
    $app.innerHTML = `
      ${pageHeader("Cash Flow", "Net trading cash, dividends received, and any manual deposits or withdrawals you record.")}
      <div class="kpi-grid">
        <div class="kpi-card"><div class="kpi-label">Net Trading Cash</div><div class="kpi-value ${plClass(cf.netTradingCash)}">${fmt(cf.netTradingCash)}</div></div>
        <div class="kpi-card"><div class="kpi-label">Net Dividends</div><div class="kpi-value pl-positive">${fmt(cf.netDividends)}</div></div>
        <div class="kpi-card"><div class="kpi-label">Manual Adjustments</div><div class="kpi-value ${plClass(cf.netAdjustments)}">${fmt(cf.netAdjustments)}</div></div>
        <div class="kpi-card kpi-card-highlight"><div class="kpi-label">Cash Balance</div><div class="kpi-value">${fmt(cf.cashBalance)}</div></div>
      </div>
      <div class="toolbar"><button class="btn btn-primary" data-action="add-adjustment">Add manual adjustment</button></div>
      <div id="adjustment-form-slot"></div>
      ${
        state.cashAdjustments.length === 0
          ? emptyState("No manual deposits or withdrawals recorded. Use this to record initial capital, top-ups, or cash withdrawals.")
          : `<div class="table-scroll"><table class="data-table">
        <thead><tr><th>Date</th><th>Note</th><th class="num">Amount</th><th></th></tr></thead>
        <tbody>
          ${[...state.cashAdjustments]
            .sort((a, b) => (a.date < b.date ? 1 : -1))
            .map(
              (a) => `<tr>
              <td>${esc(a.date)}</td>
              <td>${esc(a.note || "—")}</td>
              <td class="num ${plClass(a.amount)}">${fmt(a.amount)}</td>
              <td class="row-actions"><button class="icon-btn icon-btn-danger" data-action="delete-adj" data-id="${a.id}">Delete</button></td>
            </tr>`
            )
            .join("")}
        </tbody>
      </table></div>`
      }
    `;
    $app.querySelector('[data-action="add-adjustment"]').addEventListener("click", renderAdjustmentForm);
    $app.querySelectorAll('[data-action="delete-adj"]').forEach((btn) =>
      btn.addEventListener("click", async () => {
        if (!confirm("Delete this cash adjustment?")) return;
        await DB.remove("cashAdjustments", Number(btn.dataset.id));
        await loadAll();
        renderCashFlow();
        showToast("Adjustment deleted.");
      })
    );
  }

  function renderAdjustmentForm() {
    const slot = document.getElementById("adjustment-form-slot");
    slot.innerHTML = `
      <form class="panel-form" data-form="adjustment">
        <h2>Add manual cash adjustment</h2>
        <div class="form-grid">
          <label>Date<input type="date" name="date" required value="${todayISO()}" max="${todayISO()}"/></label>
          <label>Amount (LKR)<input type="number" name="amount" step="0.01" required placeholder="Positive = deposit, negative = withdrawal"/></label>
          <label>Note<input type="text" name="note" placeholder="e.g. Initial capital"/></label>
        </div>
        <div class="form-actions">
          <button type="submit" class="btn btn-primary">Save</button>
          <button type="button" class="btn btn-secondary" data-action="cancel">Cancel</button>
        </div>
      </form>`;
    const form = slot.querySelector("form");
    form.querySelector('[data-action="cancel"]').addEventListener("click", () => (slot.innerHTML = ""));
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const amount = parseFloat(fd.get("amount"));
      if (!Calc.isFiniteNumber(amount) || amount === 0) return showToast("Enter a non-zero amount.", true);
      await DB.put("cashAdjustments", { id: uid(), date: fd.get("date"), amount, note: fd.get("note") || "" });
      slot.innerHTML = "";
      await loadAll();
      renderCashFlow();
      showToast("Adjustment saved.");
    });
  }

  // ---------- Settings ----------
  function renderSettings() {
    $app.innerHTML = `
      ${pageHeader("Settings & Backup", "Defaults used across the app, plus backup, restore, and demo data.")}
      <section class="panel-form">
        <h2>Defaults</h2>
        <form class="form-grid" data-form="defaults">
          <label>Default brokerage %<input type="number" name="brokerageFeePct" min="0" step="0.01" value="${(state.settings.brokerageFeePct * 100).toFixed(2)}"/></label>
          <label>Default dividend tax %<input type="number" name="dividendTaxPct" min="0" max="99" step="0.1" value="${(state.settings.dividendTaxPct * 100).toFixed(1)}"/></label>
          <div class="form-actions"><button type="submit" class="btn btn-primary">Save defaults</button></div>
        </form>
      </section>
      <section class="panel-form">
        <h2>Backup &amp; restore</h2>
        <p class="hint">With Firebase configured, your data syncs to your account and stays cached here for offline use. Export backups regularly.</p>
        <div class="form-actions">
          <button class="btn btn-secondary" data-action="export">Export backup (.json)</button>
          <label class="btn btn-secondary file-btn">Restore from backup<input type="file" accept="application/json" data-action="import" hidden/></label>
        </div>
      </section>
      <section class="panel-form">
        <h2>Demo data</h2>
        <p class="hint">Loads sample transactions, holdings, and dividends so you can see the app populated. Only available when your data is empty.</p>
        <div class="form-actions">
          <button class="btn btn-secondary" data-action="load-demo" ${state.transactions.length ? "disabled" : ""}>Load demo data</button>
        </div>
      </section>
      <section class="panel-form">
        <h2 class="danger-heading">Danger zone</h2>
        <p class="hint">Permanently deletes your local and synced portfolio data.</p>
        <div class="form-actions"><button class="btn btn-danger" data-action="wipe">Erase all data</button></div>
      </section>
    `;

    $app.querySelector('[data-form="defaults"]').addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const brokerageFeePct = parseFloat(fd.get("brokerageFeePct")) / 100;
      const dividendTaxPct = parseFloat(fd.get("dividendTaxPct")) / 100;
      await DB.setSetting("brokerageFeePct", brokerageFeePct);
      await DB.setSetting("dividendTaxPct", dividendTaxPct);
      await loadAll();
      showToast("Defaults saved.");
    });

    $app.querySelector('[data-action="export"]').addEventListener("click", async () => {
      const data = await DB.getAllData();
      const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), data }, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `cse-portfolio-backup-${todayISO()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      showToast("Backup downloaded.");
    });

    $app.querySelector('[data-action="import"]').addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      if (!confirm("Restoring a backup REPLACES all current data. Continue?")) {
        e.target.value = "";
        return;
      }
      try {
        const text = await file.text();
        const parsed = JSON.parse(text);
        const data = parsed.data || parsed;
        for (const key of DB.STORES) {
          if (!Array.isArray(data[key])) throw new Error(`Backup file is missing the "${key}" section.`);
        }
        await DB.replaceAllData(data);
        await loadAll();
        renderSettings();
        showToast("Backup restored.");
      } catch (err) {
        showToast("Could not restore backup: " + err.message, true);
      }
    });

    $app.querySelector('[data-action="load-demo"]')?.addEventListener("click", async () => {
      if (DB.STORES.some(store => store !== "settings" && state[store]?.length)) { showToast("Demo requires an empty portfolio.", true); return; }
      if (Cloud.isConfigured() && !DB.isInitialSyncOk()) { showToast("Connect and complete sync before loading demo data.", true); return; }
      await DB.replaceAllData(Demo.buildDemoData());
      await loadAll();
      location.hash = "#/dashboard";
      showToast("Demo data loaded.");
    });

    $app.querySelector('[data-action="wipe"]').addEventListener("click", async () => {
      if (!confirm("This permanently deletes ALL data in this browser. Type OK to confirm this action.")) return;
      if (!confirm("Are you absolutely sure? This cannot be undone.")) return;
      await DB.wipeAllData();
      await loadAll();
      renderSettings();
      showToast("All data erased.");
    });
  }

  // ---------- auth / user badge ----------
  function renderUserBadge(user) {
    const el = document.getElementById("user-badge");
    if (!el) return;
    const avatar = user.picture
      ? `<img src="${esc(user.picture)}" alt="" class="user-avatar" />`
      : `<span class="user-avatar user-avatar-fallback">${esc((user.name || "?").slice(0, 1).toUpperCase())}</span>`;
    el.innerHTML = `${avatar}<span class="user-name">${esc(user.name)}</span><button type="button" class="btn btn-secondary btn-sm" id="signout-btn">Sign out</button>`;
    document.getElementById("signout-btn").addEventListener("click", () => Auth.signOut());
  }

  // ---------- boot ----------
  let starting = false;
  async function startApp() {
    if (starting) return;
    starting = true;
    document.getElementById("auth-loading").hidden = true;
    document.getElementById("login-screen").hidden = true;
    document.getElementById("app-shell").hidden = false;
    $app.textContent = "Loading your portfolio…";
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("service-worker.js").catch(() => {});
    }
    await DB.syncWithCloud();
    await loadAll();
    if (!location.hash) location.hash = "#/dashboard";
    navigate();
  }

  function boot() {
    Auth.init((user) => {
      DB.setUser(user.uid);
      renderUserBadge(user);
      startApp();
    });

    Auth.renderButton(document.getElementById("google-signin-button"));
  }

  boot();
})();
