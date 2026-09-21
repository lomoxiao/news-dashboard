// 「週次ニュース」画面（news.html）のロジック。
import { loadAll, indexById, evidenceInPeriod, evidenceDate, TRACKS, TRACK_BY_ID, CONFIDENCE_LABEL } from "./data.js";

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined) node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) if (c) node.appendChild(c);
  return node;
}

// セルの不透明度：値ごとの固定ステップ（モックアップの実測値 1→0.51/2→0.67/3→0.83/4→0.99 から
// 逆算した式。行内の最大値による相対正規化ではなく、値そのものに対する固定スケール）。
function cellOpacity(count) {
  return Math.min(1, 0.35 + 0.16 * count);
}

function renderTrend(digestsAsc, evidence) {
  const perDigest = digestsAsc.map((d) => {
    const inRange = evidenceInPeriod(evidence, d.periodStart, d.periodEnd);
    const counts = {};
    let emptyTrackCount = 0;
    for (const e of inRange) {
      if (!e.track) {
        emptyTrackCount++;
        continue;
      }
      counts[e.track] = (counts[e.track] ?? 0) + 1;
    }
    return { counts, emptyTrackCount };
  });

  const head = document.getElementById("trend-head-cols");
  head.textContent = digestsAsc.map((_, i) => i + 1).join(" ");

  const body = document.getElementById("trend-body");
  body.innerHTML = "";
  for (const track of TRACKS) {
    const cells = perDigest.map((d) => {
      const count = d.counts[track.id] ?? 0;
      if (count === 0) {
        return el("span", { class: "pl-trend-cell", style: "background:var(--pl-bg); color:var(--pl-text-muted); opacity:1;", text: "0" });
      }
      return el("span", {
        class: "pl-trend-cell",
        style: `background:${track.color}; color:#FFFFFF; opacity:${cellOpacity(count)};`,
        text: String(count),
      });
    });
    body.appendChild(el("div", { class: "pl-trend-row" }, [el("span", { class: "label", text: track.label }), ...cells]));
  }

  const lastEmpty = perDigest[perDigest.length - 1]?.emptyTrackCount ?? 0;
  document.getElementById("trend-note").textContent =
    lastEmpty > 0 ? `系統が空欄の出典（最新回は ${lastEmpty} 件）があります。` : "";
}

function renderRoundButtons(digestsAsc, selectedId, onSelect) {
  const container = document.getElementById("round-list");
  container.innerHTML = "";
  digestsAsc.forEach((d, i) => {
    container.appendChild(
      el("button", {
        type: "button",
        class: `pl-round-btn${d.id === selectedId ? " is-active" : ""}`,
        text: `第${i + 1}回 ${d.periodStart.slice(5)}〜${d.periodEnd.slice(5)}`,
        onclick: () => onSelect(d.id),
      })
    );
  });
}

function toggleDetail(bodyEl, item, evidenceById) {
  const existing = bodyEl.querySelector(".pl-news-detail");
  if (existing) {
    existing.remove();
    return;
  }
  const ev = item.evidenceId ? evidenceById.get(item.evidenceId) : null;
  const detail = el("div", { class: "pl-news-detail" }, [
    el("span", { text: item.summary || ev?.summary || "（詳細な要約はありません）" }),
    ev?.source ? el("a", { href: ev.source, target: "_blank", rel: "noopener", text: "出典を開く" }) : null,
  ]);
  bodyEl.appendChild(detail);
}

function renderMain(digest, roundNumber, digestsAsc, evidence, evidenceById, entityById) {
  const inRange = evidenceInPeriod(evidence, digest.periodStart, digest.periodEnd);
  document.getElementById("news-title").textContent = `金融決済ウィークリー 第${roundNumber}回`;
  document.getElementById("news-subtitle").textContent =
    `対象期間 ${digest.periodStart} 〜 ${digest.periodEnd.slice(5)} ・出典 ${inRange.length} 件からトップ10`;

  const list = document.getElementById("news-list-lg");
  list.innerHTML = "";
  const items = digest.top10.slice().sort((a, b) => a.rank - b.rank);
  for (const item of items) {
    const ev = item.evidenceId ? evidenceById.get(item.evidenceId) : null;
    const track = TRACK_BY_ID[item.track];
    const entityIds = ev?.entities ?? [];

    const bodyEl = el("div", { class: "pl-news-body-lg" });
    bodyEl.appendChild(
      el("button", {
        type: "button",
        class: "pl-news-headline-btn",
        text: item.headline,
        onclick: () => toggleDetail(bodyEl, item, evidenceById),
      })
    );

    const metaChildren = [
      ev ? el("span", { class: "date", text: evidenceDate(ev).slice(5) }) : null,
      ev ? el("span", { class: `pl-confidence ${ev.confidence}`, text: CONFIDENCE_LABEL[ev.confidence] ?? ev.confidence }) : null,
      track ? el("span", { class: "pl-track-pill", style: `color:${track.color}`, text: track.label }) : null,
    ].filter(Boolean);
    if (entityIds.length) metaChildren.push(el("span", { class: "pl-news-divider" }));
    for (const id of entityIds) {
      const entity = entityById.get(id);
      if (!entity) continue;
      metaChildren.push(el("a", { class: "pl-entity-chip", href: `player.html?id=${encodeURIComponent(id)}`, text: entity.name }));
    }
    bodyEl.appendChild(el("div", { class: "pl-news-meta-lg" }, metaChildren));

    list.appendChild(
      el("li", { class: "pl-news-item-lg" }, [el("span", { class: "pl-news-rank-lg", text: String(item.rank) }), bodyEl])
    );
  }
  if (items.length === 0) {
    list.appendChild(el("li", { class: "pl-empty-state", text: "この回のトップ10はありません。" }));
  }
}

async function main() {
  const { entities, evidence, weeklyDigests } = await loadAll();
  const entityById = indexById(entities);
  const evidenceById = indexById(evidence);

  if (weeklyDigests.length === 0) {
    document.getElementById("news-root").innerHTML = '<div class="pl-empty-state">週次データがまだありません。</div>';
    return;
  }

  const digestsAsc = weeklyDigests.slice().sort((a, b) => (a.periodStart < b.periodStart ? -1 : 1));
  renderTrend(digestsAsc, evidence);

  let selectedId = digestsAsc[digestsAsc.length - 1].id; // 最新回をデフォルト選択

  function select(id) {
    selectedId = id;
    const idx = digestsAsc.findIndex((d) => d.id === id);
    renderRoundButtons(digestsAsc, selectedId, select);
    renderMain(digestsAsc[idx], idx + 1, digestsAsc, evidence, evidenceById, entityById);
  }
  select(selectedId);
}

main().catch((err) => {
  console.error(err);
  document.getElementById("news-root").innerHTML =
    '<div class="pl-empty-state">データの読み込みに失敗しました。Firestoreにまだデータが同期されていない可能性があります。</div>';
});
