// Year view: income, cost of goods, fees, shipping, mileage. CSV and print.
import { esc, $, toast, bind, honesty, promptSheet, confirmSheet, download } from "../dom.js";
import { formatUsd } from "../../core/inventory.js";
import { yearTotals, yearsFrom, yearCsv, TAX_DISCLAIMER } from "../../core/taxes.js";
import { siteName } from "../../core/sites.js";
import {
  getTrips, addTrip, removeTrip, getSettings, mileageRateFor, IRS_PAGE, ymd
} from "../../core/settings.js";
import { money } from "../../core/inventory.js";

export function renderTaxes(ctx, el, year) {
  const y = Number(year) || new Date().getFullYear();
  const trips = getTrips();
  const totals = yearTotals(ctx.items, trips, y);
  const years = yearsFrom(ctx.items, trips);
  if (!years.includes(y)) years.unshift(y);
  const currentRate = mileageRateFor(Date.now(), getSettings());

  el.innerHTML = `
    <div class="topbar"><a class="iconbtn" href="#/home" aria-label="Back">‹</a><h2>Taxes</h2><span class="spacer48"></span></div>

    <div class="card">
      <div class="row between"><h3>${esc(String(y))} summary</h3>${honesty("ok", "Working")}</div>
      <p class="tiny attn">${esc(TAX_DISCLAIMER)}</p>
      <label class="field"><span>Year</span>
        <select id="tax-year">${years.map(n => `<option value="${n}" ${n === y ? "selected" : ""}>${n}</option>`).join("")}</select>
      </label>
      <div class="stats tight">
        <div><span class="tiny muted">Income</span><b>${esc(formatUsd(totals.income))}</b></div>
        <div><span class="tiny muted">Cost of goods</span><b>${esc(formatUsd(totals.cogs))}</b></div>
        <div><span class="tiny muted">Fees</span><b>${esc(formatUsd(totals.fees))}</b></div>
        <div><span class="tiny muted">Shipping you paid</span><b>${esc(formatUsd(totals.shipping))}</b></div>
        <div><span class="tiny muted">Supplies</span><b>${esc(formatUsd(totals.supplies))}</b></div>
        <div><span class="tiny muted">Discounts</span><b>${esc(formatUsd(totals.discounts))}</b></div>
        <div><span class="tiny muted">Refunds</span><b>${esc(formatUsd(totals.refunds))}</b></div>
        <div><span class="tiny muted">After cost, fees, shipping, supplies, discounts, and refunds</span><b>${esc(formatUsd(totals.goodsProfit))}</b></div>
        <div><span class="tiny muted">Money received</span><b>${esc(totals.receivedCount ? formatUsd(totals.received) : "—")}</b></div>
        <div><span class="tiny muted">Mileage</span><b>${esc(String(totals.miles))} mi</b></div>
      </div>
      <p class="small">Mileage at the rates you logged: <b>${esc(formatUsd(totals.mileageDeduction))}</b> (${totals.tripCount} trip${totals.tripCount === 1 ? "" : "s"}).</p>
      <p class="tiny muted">The current IRS business mileage rate we have is ${esc(String(currentRate.rate))} per mile (${esc(currentRate.source)}). You can confirm at <a href="${esc(IRS_PAGE)}" target="_blank" rel="noopener">IRS.gov</a> and change the rate in Settings. ${currentRate.stale ? "This may be out of date." : ""}</p>
      <div class="row wrap" style="margin-top:10px;gap:8px">
        <button type="button" class="btn sm soft" data-act="csv">⬇️ Export CSV</button>
        <button type="button" class="btn sm soft" data-act="print">🖨️ Printable summary</button>
      </div>
    </div>

    <div class="card" id="mileage">
      <div class="row between"><h3>Mileage log</h3>${honesty("ok", "Working")}</div>
      <p class="small muted">Log trips for your selling (for example, to a post office or a pickup). Each trip stores the rate that applied on that date, unless you set a rate in Settings.</p>
      <button type="button" class="btn" data-act="addtrip">+ Add a trip</button>
      ${totals.trips.length ? `<ul class="itemlist" style="margin-top:12px">${totals.trips.map(tripRow).join("")}</ul>`
        : `<p class="tiny muted" style="margin-top:10px">No trips logged in ${esc(String(y))}.</p>`}
    </div>

    <div class="card">
      <h3>Sold items in ${esc(String(y))}</h3>
      ${totals.sold.length ? `<div class="tablewrap"><table class="fee-table">
        <thead><tr><th>Date</th><th>Item</th><th>Sale</th><th>Profit</th></tr></thead>
        <tbody>${totals.sold.map(itemRow).join("")}</tbody>
      </table></div>` : `<p class="muted">No sold items in ${esc(String(y))}.</p>`}
    </div>

    <p class="tiny muted center" id="tax-print-note">${esc(TAX_DISCLAIMER)}</p>
  `;

  $("#tax-year", el).addEventListener("change", e => {
    ctx.go("#/taxes/" + e.target.value);
  });

  bind(el, {
    addtrip: async () => {
      const rate = mileageRateFor(Date.now());
      const values = await promptSheet({
        title: "Add a trip",
        body: `The rate for today is ${rate.rate} per mile (${rate.source}). You can change the rate in Settings.`,
        ok: "Add trip",
        fields: [
          { id: "date", type: "date", label: "Date", value: ymd(), required: true },
          { id: "miles", type: "text", inputmode: "decimal", label: "Miles", placeholder: "12", required: true },
          { id: "purpose", type: "text", label: "Purpose (optional)", placeholder: "Post office, pickup…" }
        ]
      });
      if (!values) return;
      const miles = money(values.miles);
      if (miles == null || miles < 0) { toast("Enter the miles"); return; }
      const info = mileageRateFor(values.date);
      addTrip({ date: values.date, miles, purpose: values.purpose, rate: info.rate, rateSource: info.source });
      toast("Trip added");
      ctx.render();
    },
    deltrip: async b => {
      if (!(await confirmSheet({ title: "Remove this trip?", body: "It will be removed from the mileage log on this phone.", ok: "Remove", danger: true }))) return;
      removeTrip(b.dataset.id);
      toast("Trip removed");
      ctx.render();
    },
    csv: () => {
      const fresh = yearTotals(ctx.items, getTrips(), y);
      const text = yearCsv(fresh);
      download(`flip-helper-taxes-${y}.csv`, text, "text/csv");
      toast("CSV saved");
    },
    print: () => {
      document.documentElement.dataset.print = "taxes";
      const prev = document.title;
      document.title = `Jessica's Flip Side — ${y} summary`;
      // A print-only block is already in the page; add a simple text preview sheet? Just print.
      window.print();
      document.title = prev;
      document.documentElement.removeAttribute("data-print");
    }
  });
}

function tripRow(t) {
  return `<li>
    <div class="li">
      <span class="grow">
        <b>${esc(t.date)}</b>
        <span class="tiny muted">${esc(t.purpose || "Trip")} · ${esc(String(t.rate))} / mile${t.rateSource ? " · " + esc(t.rateSource) : ""}</span>
      </span>
      <span class="tiny muted price">${esc(String(t.miles))} mi · ${esc(formatUsd(t.deduction))}</span>
      <button type="button" class="btn sm dangerghost" data-act="deltrip" data-id="${esc(t.id)}">Remove</button>
    </div>
  </li>`;
}

function itemRow(item) {
  // Use the same rules as the year totals (new cost fields default to 0).
  const hasM = item.marketplaceFees != null && item.marketplaceFees !== "";
  const hasP = item.paymentFees != null && item.paymentFees !== "";
  const feeAmt = (hasM || hasP) ? (money(item.marketplaceFees) ?? 0) + (money(item.paymentFees) ?? 0) : (money(item.fees) ?? 0);
  const ship = (item.actualShipCost != null && item.actualShipCost !== "") ? (money(item.actualShipCost) ?? 0) : (money(item.shippingPaid) ?? 0);
  const profit = (money(item.salePrice) ?? 0) - (money(item.costPaid) ?? 0) - feeAmt - ship - (money(item.supplies) ?? 0) - (money(item.discounts) ?? 0) - (money(item.refunds) ?? (item.returns ? money(item.returns.refundAmount) ?? 0 : 0));
  const d = item.soldAt ? ymd(item.soldAt) : "";
  return `<tr>
    <td>${esc(d)}</td>
    <td><a href="#/item/${esc(item.id)}">${esc(item.title || "Untitled item")}</a>${item.soldOn ? `<div class="tiny muted">${esc(siteName(item.soldOn))}</div>` : ""}</td>
    <td class="num">${esc(formatUsd(item.salePrice))}</td>
    <td class="num">${esc(formatUsd(profit))}</td>
  </tr>`;
}
