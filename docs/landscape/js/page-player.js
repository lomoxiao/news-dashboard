// 「企業の関係図」画面（player.html）のロジック。
import {
  loadAll, indexById, evidenceDate, primaryLayer, LAYER_LABEL, TRACK_BY_ID, CONFIDENCE_LABEL, newsRefsForEntity,
} from "./data.js";
import { buildRadialDiagram } from "./svg-diagram.js";

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k === "html") node.innerHTML = v;
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined) node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) if (c) node.appendChild(c);
  return node;
}

function getEntityIdFromQuery() {
  return new URLSearchParams(location.search).get("id");
}

function counterpartId(relation, entityId) {
  return relation.from === entityId ? relation.to : relation.from;
}

/** relationを裏付けるevidence（このrelationのfrom/to/kindと一致するrelations要素を持つevidence）。 */
function evidenceForRelation(relation, evidenceList) {
  return evidenceList.filter((e) =>
    (e.relations ?? []).some((r) => r.from === relation.from && r.to === relation.to && r.kind === relation.kind)
  );
}

function yearOf(dateStr) {
  const m = String(dateStr).match(/\d{4}/);
  return m ? Number(m[0]) : 9999;
}

function renderEmpty(message) {
  document.getElementById("player-root").innerHTML = "";
  document.getElementById("player-root").appendChild(el("div", { class: "pl-empty-state", text: message }));
}

async function main() {
  const entityId = getEntityIdFromQuery();
  if (!entityId) {
    renderEmpty("企業が指定されていません。全体図からチップを選んでください。");
    return;
  }

  const { entities, relations, evidence, newsRefs } = await loadAll();
  const byId = indexById(entities);
  const centerEntity = byId.get(entityId);
  if (!centerEntity) {
    renderEmpty("指定された企業が見つかりません。");
    return;
  }

  document.title = `${centerEntity.name} の関係図 — Payments Landscape`;

  // パンくず
  document.getElementById("breadcrumb-layer").textContent = LAYER_LABEL[primaryLayer(centerEntity)] ?? "";
  document.getElementById("breadcrumb-current").textContent = centerEntity.name;

  // ヘッダー（サイドバー上部）
  document.getElementById("entity-name").textContent = centerEntity.name;
  document.getElementById("entity-meta").textContent = `${centerEntity.type}・${centerEntity.region}`;
  const tagsEl = document.getElementById("entity-tags");
  tagsEl.innerHTML = "";
  for (const l of centerEntity.layers ?? []) {
    tagsEl.appendChild(el("span", { text: LAYER_LABEL[l] ?? l }));
  }

  // 直接の関係を組み立てる
  const direct = relations.filter((r) => r.from === entityId || r.to === entityId);
  const satellites = direct
    .map((relation) => {
      const cpId = counterpartId(relation, entityId);
      const entity = byId.get(cpId);
      if (!entity) return null;
      const supportingEvidence = evidenceForRelation(relation, evidence);
      return { entity, relation, recordCount: supportingEvidence.length || 1, supportingEvidence };
    })
    .filter(Boolean)
    // 直近に確認された関係から時計回りに並べる（意味のある固定順にするため）。
    .sort((a, b) => (a.relation.lastSeenDate < b.relation.lastSeenDate ? 1 : -1));

  const diagramContainer = document.getElementById("diagram");
  diagramContainer.innerHTML = "";
  const caption = document.getElementById("edge-caption");

  if (satellites.length === 0) {
    diagramContainer.appendChild(el("div", { class: "pl-empty-state", text: "直接の関係が記録されていません。" }));
    caption.textContent = "";
  } else {
    diagramContainer.appendChild(
      buildRadialDiagram({
        centerEntity,
        satellites,
        trackById: TRACK_BY_ID,
        onSelectSatellite: (id) => {
          location.href = `player.html?id=${encodeURIComponent(id)}`;
        },
        onSelectEdge: (relationId) => {
          highlightRelation(relationId, satellites, caption, entityId);
        },
      })
    );
  }

  // 関係の一覧（evidence単位、日付降順）
  const rows = [];
  for (const s of satellites) {
    for (const ev of s.supportingEvidence) {
      rows.push({
        relationId: s.relation.id,
        counterpart: s.entity.name,
        kind: s.relation.kind,
        date: evidenceDate(ev),
        confidence: ev.confidence,
        track: ev.track,
      });
    }
  }
  rows.sort((a, b) => (a.date < b.date ? 1 : -1));

  const tbody = document.getElementById("rel-table-body");
  tbody.innerHTML = "";
  for (const row of rows) {
    const track = TRACK_BY_ID[row.track];
    tbody.appendChild(
      el("tr", { "data-relation-id": row.relationId }, [
        el("td", { class: "name-cell", text: row.counterpart }),
        el("td", { text: row.kind }),
        el("td", { class: "date-cell", text: row.date.slice(5) }),
        el("td", {}, [
          el("span", { class: `pl-confidence ${row.confidence}`, text: CONFIDENCE_LABEL[row.confidence] ?? row.confidence }),
        ]),
        el("td", {}, [
          track ? el("span", { class: "pl-track-pill", style: `color:${track.color}`, text: track.label }) : null,
        ]),
      ])
    );
  }
  if (rows.length === 0) {
    tbody.appendChild(
      el("tr", {}, [el("td", { colspan: "5", class: "pl-empty-state", text: "関係の記録がありません。" })])
    );
  }

  renderRelationsMobile(satellites, entityId);

  // 今後の予定（milestones）：この企業に言及するevidence全体から集める
  const milestoneMap = new Map();
  for (const ev of evidence) {
    if (!(ev.entities ?? []).includes(entityId)) continue;
    for (const m of ev.milestones ?? []) {
      if (m && m.date && m.label) milestoneMap.set(`${m.date}__${m.label}`, m);
    }
  }
  const milestones = [...milestoneMap.values()].sort((a, b) => yearOf(a.date) - yearOf(b.date));
  const milestoneSection = document.getElementById("milestone-section");
  const milestoneList = document.getElementById("milestone-list");
  milestoneList.innerHTML = "";
  for (const m of milestones) {
    milestoneList.appendChild(
      el("li", {}, [el("span", { class: "pl-milestone-date", text: m.date }), el("span", { text: m.label })])
    );
  }
  milestoneSection.style.display = milestones.length ? "" : "none";

  renderEvents(evidence, entityId, byId);
  renderNewsRefs(newsRefsForEntity(newsRefs, entityId));
  setupMobileTabs();
}

/**
 * スマホ用の関係の一覧（関係図の代わり）。関係ごとに1行、最新の記録の日付が新しい順。
 * タップすると「関係の履歴」（edge.html）へ移る。PCでは CSS で非表示（PCは関係図＋表）。
 */
function renderRelationsMobile(satellites, centerEntityId) {
  const list = document.getElementById("rel-list-mobile");
  if (!list) return;
  list.innerHTML = "";
  const items = satellites
    .map((s) => {
      const records = s.supportingEvidence.slice().sort((a, b) => (evidenceDate(a) < evidenceDate(b) ? 1 : -1));
      const latest = records[0];
      return {
        relation: s.relation,
        counterpart: s.entity.name,
        date: (latest ? evidenceDate(latest) : null) ?? s.relation.lastSeenDate ?? "",
        count: records.length,
        confidence: latest?.confidence ?? s.relation.confidence,
        track: TRACK_BY_ID[latest?.track ?? s.relation.tracks?.[0]],
      };
    })
    .sort((a, b) => (a.date < b.date ? 1 : -1));

  for (const it of items) {
    const href = `edge.html?rel=${encodeURIComponent(it.relation.id)}&via=${encodeURIComponent(centerEntityId)}`;
    list.appendChild(
      el("li", {}, [
        el("a", { class: "pl-rel-mobile-item", href }, [
          el("div", { class: "row" }, [
            el("span", { class: "name", text: it.counterpart }),
            el("span", { class: "date", text: String(it.date).slice(5) }),
          ]),
          el("div", { class: "row tags" }, [
            el("span", { class: "kind", text: it.count > 1 ? `${it.relation.kind} ×${it.count}` : it.relation.kind }),
            el("span", { class: `pl-confidence ${it.confidence}`, text: CONFIDENCE_LABEL[it.confidence] ?? it.confidence }),
            it.track ? el("span", { class: "pl-track-pill", style: `color:${it.track.color}`, text: it.track.label }) : null,
          ]),
        ]),
      ])
    );
  }
  if (items.length === 0) {
    list.appendChild(el("li", { class: "pl-empty-state", text: "関係の記録がありません。" }));
  }
}

const MOBILE_TABS = [
  { key: "rel", label: "関係", empty: "" },
  { key: "events", label: "出来事", empty: "記録されている出来事はありません。" },
  { key: "news", label: "ニュース", empty: "この企業に照合された news-dashboard の記事はありません。" },
  { key: "plan", label: "予定", empty: "記録されている今後の予定はありません。" },
];

/**
 * スマホ用の「関係／ニュース／予定」切り替え。PCでは3つの欄が同時に見えるため、
 * この切り替えは CSS（幅900px以下）でのみ効く。中身が空の欄は、空であることを表示する。
 */
function setupMobileTabs() {
  const root = document.getElementById("player-root");
  const box = document.getElementById("mtabs");
  const emptyEl = document.getElementById("mtab-empty");
  if (!root || !box || !emptyEl) return;
  box.innerHTML = "";
  const buttons = new Map();

  function select(key) {
    root.dataset.mtab = key;
    for (const [k, btn] of buttons) {
      btn.classList.toggle("is-active", k === key);
      btn.setAttribute("aria-pressed", k === key ? "true" : "false");
    }
    const sec = root.querySelector(`[data-mtab-sec="${key}"]`);
    const isEmpty = !sec || sec.style.display === "none";
    emptyEl.textContent = isEmpty ? MOBILE_TABS.find((t) => t.key === key)?.empty ?? "" : "";
    emptyEl.classList.toggle("is-shown", isEmpty && emptyEl.textContent !== "");
  }

  for (const t of MOBILE_TABS) {
    const btn = el("button", { type: "button", class: "pl-mtab", text: t.label, onclick: () => select(t.key) });
    buttons.set(t.key, btn);
    box.appendChild(btn);
  }
  select("rel");
}

/**
 * 「出来事」欄。この企業を entities に含む evidence を記事日（published優先）の新しい順に並べる。
 * 「関係の一覧」（rel-table）は他社との関係に紐づく evidence だけを拾うため、relations が空の
 * 単独の出来事（例：自治体キャンペーンなど）はそこに出てこない。ここでは entities に載っていれば
 * relations の有無を問わず拾う。追加リサーチ（2026-04以降）分もこの一覧に含まれる。
 */
function renderEvents(evidence, entityId, byId) {
  const section = document.getElementById("events-section");
  const list = document.getElementById("event-list");
  list.innerHTML = "";
  const items = evidence
    .filter((e) => (e.entities ?? []).includes(entityId))
    .slice()
    .sort((a, b) => (evidenceDate(a) < evidenceDate(b) ? 1 : -1));

  if (items.length === 0) {
    section.style.display = "none";
    return;
  }
  section.style.display = "";

  for (const ev of items) {
    const track = TRACK_BY_ID[ev.track];
    const relationLinks = (ev.relations ?? [])
      .map((r) => {
        const cpId = r.from === entityId ? r.to : r.from;
        const cp = byId.get(cpId);
        if (!cp) return null;
        const relId = `${r.from}__${r.to}__${r.kind}`;
        return el("a", {
          class: "pl-event-relation-link",
          href: `edge.html?rel=${encodeURIComponent(relId)}&via=${encodeURIComponent(entityId)}`,
          text: `${cp.name}・${r.kind}`,
        });
      })
      .filter(Boolean);

    list.appendChild(
      el("li", { class: "pl-event-item" }, [
        el("div", { class: "pl-event-head" }, [
          el("span", { class: "pl-event-date", text: evidenceDate(ev) }),
          el("span", { class: `pl-confidence ${ev.confidence}`, text: CONFIDENCE_LABEL[ev.confidence] ?? ev.confidence }),
          track ? el("span", { class: "pl-track-pill", style: `color:${track.color}`, text: track.label }) : null,
        ]),
        el("p", { class: "pl-event-summary", text: ev.summary || "（要約なし）" }),
        relationLinks.length ? el("div", { class: "pl-event-relations" }, relationLinks) : null,
        el("div", { class: "pl-event-meta" }, [
          ev.source ? el("a", { href: ev.source, target: "_blank", rel: "noopener", text: "出典を開く" }) : null,
        ]),
        ev.caution ? el("span", { class: "pl-event-caution", text: `注意：${ev.caution}` }) : null,
      ])
    );
  }
}

/**
 * 「最近の記事（未確認・自動要約）」欄。news-dashboardの記事を企業名で機械的に
 * 照合しただけの参考情報で、Landscape本体（企業・関係・確度）の根拠ではない。
 * newsRefsが1件もなければ欄ごと非表示にする（他の欄と同じ「データが無ければ隠す」方針）。
 */
function renderNewsRefs(refs) {
  const section = document.getElementById("news-refs-section");
  const list = document.getElementById("news-refs-list");
  list.innerHTML = "";
  if (!refs.length) {
    section.style.display = "none";
    return;
  }
  section.style.display = "";
  for (const r of refs) {
    const titleChildren = [el("a", { href: r.url, target: "_blank", rel: "noopener", text: r.title })];
    const badges = [];
    if (r.confirmed) badges.push(el("span", { class: "pl-newsref-badge is-confirmed", text: "確認済み" }));
    if (r.paywalled) badges.push(el("span", { class: "pl-newsref-badge is-paywalled", text: "有料媒体" }));
    list.appendChild(
      el("li", { class: "pl-newsref-item" }, [
        el("div", { class: "pl-newsref-head" }, [el("span", { class: "pl-newsref-date", text: r.publishedAt }), ...badges]),
        el("div", { class: "pl-newsref-title" }, titleChildren),
        r.paywalled ? null : el("p", { class: "pl-newsref-summary", text: r.summary ?? "" }),
      ])
    );
  }
}

function highlightRelation(relationId, satellites, caption, centerEntityId) {
  const rows = document.querySelectorAll("#rel-table-body tr[data-relation-id]");
  for (const row of rows) {
    row.classList.toggle("is-highlighted", row.getAttribute("data-relation-id") === relationId);
  }
  const s = satellites.find((x) => x.relation.id === relationId);
  caption.innerHTML = "";
  if (s) {
    caption.appendChild(document.createTextNode(`${s.entity.name} との線を選択中 → 右に関係の履歴。`));
    const link = el("a", {
      href: `edge.html?rel=${encodeURIComponent(relationId)}&via=${encodeURIComponent(centerEntityId)}`,
      text: "履歴を全画面で見る",
    });
    caption.appendChild(document.createTextNode(" "));
    caption.appendChild(link);
    document.querySelector(`#rel-table-body tr[data-relation-id="${CSS.escape(relationId)}"]`)?.scrollIntoView({
      block: "nearest",
      behavior: "smooth",
    });
  }
}

main().catch((err) => {
  console.error(err);
  renderEmpty("データの読み込みに失敗しました。Firestoreにまだデータが同期されていない可能性があります。");
});
