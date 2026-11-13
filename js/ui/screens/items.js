import { esc, thumb, pill } from "../dom.js";
import { needsDelistHighlight, statusLine, formatUsd, pendingDelist, siteName, STAGE_LABELS, STAGES } from "../../core/inventory.js";

export function renderItems(ctx, el, filter = "all") {
  const items = ctx.items;
  const alerts = items.filter(needsDelistHighlight);
  const shown = filter === "all" ? items
    : filter === "attention" ? alerts
    : items.filter(i => i.stage === filter);
  const filters = [
    ["all", "All"],
    ["attention", "Take down"],
    ...STAGES.map(s => [s, STAGE_LABELS[s]])
  ];
  el.innerHTML = `
    <div class="topbar"><span class="spacer48"></span><h2>Items</h2><span class="spacer48"></span></div>
    <div class="seg" role="tablist">
      ${filters.map(([id, label]) => `<button type="button" class="${id === filter ? "on" : ""}" data-filter="${esc(id)}">${esc(label)}${id === "attention" && alerts.length ? ` (${alerts.length})` : ""}</button>`).join("")}
    </div>
    ${shown.length
      ? `<ul class="itemlist">${shown.map(row).join("")}</ul>`
      : `<div class="card empty"><span class="em">📦</span><p>${emptyMsg(filter)}</p>${filter === "all" ? `<a class="btn" href="#/add">Add an item</a>` : ""}</div>`}
  `;
  el.querySelectorAll("[data-filter]").forEach(b => {
    b.addEventListener("click", () => {
      ctx.go(b.dataset.filter === "all" ? "#/items" : `#/items/${b.dataset.filter}`);
    });
  });
}

function emptyMsg(filter) {
  if (filter === "attention") return "Nothing waiting to be taken down.";
  if (filter === "draft") return "No drafts.";
  if (filter === "listed") return "Nothing is listed yet.";
  if (filter === "sold") return "Nothing marked sold yet.";
  if (filter === "shipped") return "Nothing marked shipped yet.";
  return "No items yet. Take a photo to start a draft.";
}

function row(item) {
  const alert = needsDelistHighlight(item);
  const pending = pendingDelist(item);
  const extra = alert
    ? `<span class="pill pill-warn">Take it down${pending.length ? " · " + pending.map(siteName).join(", ") : ""}</span>`
    : pill(statusLine(item), item.stage);
  const price = (item.stage === "sold" || item.stage === "shipped")
    ? formatUsd(item.salePrice)
    : (item.askingPrice != null ? formatUsd(item.askingPrice) : "");
  return `<li>
    <a class="li ${alert ? "alert" : ""}" href="#/item/${esc(item.id)}">
      ${thumb(item)}
      <span class="grow">
        <b class="clamp2">${esc(item.title || "Untitled item")}</b>
        <span class="tiny muted">${extra}${item.binLocation ? " · Bin " + esc(item.binLocation) : ""}</span>
      </span>
      <span class="tiny muted price">${esc(price)}</span>
    </a>
  </li>`;
}
