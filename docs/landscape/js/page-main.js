// 「全体図」画面（index.html）のロジック。
import {
  loadAll, latestDigest, entitiesInPeriod, evidenceDate, groupByLayer,
  LAYERS, TRACKS, REGION_COLOR, CONFIDENCE_LABEL,
} from "./data.js";

const state = {
  entities: [],
  relations: [],
  evidence: [],
  weeklyDigests: [],
  weekEntityIds: new Set(),
  checkedRegions: new Set(["国内", "海外"]),
  checkedTracks: new Set(TRACKS.map((t) => t.id)),
  onlyThisWeek: false,
  query: "",
};

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) if (c) node.appendChild(c);
  return node;
}

function computeWeekEntityIds() {
  const digest = latestDigest(state.weeklyDigests);
  if (!digest) return new Set();
  const evidenceInTracks = state.evidence.filter(
    (e) => state.checkedTracks.size === 0 || state.checkedTracks.has(e.track) || !e.track
  );
  return entitiesInPeriod(evidenceInTracks, digest.periodStart, digest.periodEnd);
}

function renderFilters() {
  const regionGroup = document.getElementById("filter-region");
  regionGroup.innerHTML = "";
  for (const region of ["国内", "海外"]) {
    regionGroup.appendChild(
      el("label", { class: "pl-filter-item" }, [
        el("input", {
          type: "checkbox",
          checked: state.checkedRegions.has(region) ? "checked" : null,
          onchange: (ev) => {
            if (ev.target.checked) state.checkedRegions.add(region);
            else state.checkedRegions.delete(region);
            rerender();
          },
        }),
        el("span", { class: "pl-dot", style: `background:${REGION_COLOR[region]}` }),
        el("span", { text: region }),
      ])
    );
  }

  const displayGroup = document.getElementById("filter-display");
  displayGroup.innerHTML = "";
  displayGroup.appendChild(
    el("label", { class: "pl-filter-item" }, [
      el("input", {
        type: "checkbox",
        onchange: (ev) => {
          state.onlyThisWeek = ev.target.checked;
          rerender();
        },
      }),
      el("span", { text: "今週動いたものだけ" }),
    ])
  );

  const trackGroup = document.getElementById("filter-track");
  trackGroup.innerHTML = "";
  for (const track of TRACKS) {
    trackGroup.appendChild(
      el("label", { class: "pl-filter-item" }, [
        el("input", {
          type: "checkbox",
          checked: "checked",
          onchange: (ev) => {
            if (ev.target.checked) state.checkedTracks.add(track.id);
            else state.checkedTracks.delete(track.id);
            state.weekEntityIds = computeWeekEntityIds();
            rerender();
          },
        }),
        el("span", { class: "pl-dot", style: `background:${track.color}` }),
        el("span", { text: track.label }),
      ])
    );
  }
}

function renderStats() {
  const confCounts = { primary: 0, secondary: 0, unverified: 0, reference: 0 };
  for (const e of state.evidence) confCounts[e.confidence] = (confCounts[e.confidence] ?? 0) + 1;
  const weeklyCount = state.entities.filter((e) => e.origin !== "baseline").length;
  const baselineCount = state.entities.length - weeklyCount;
  document.getElementById("stats").textContent =
    `企業 ${weeklyCount}（+ベース情報 ${baselineCount}） ・関係 ${state.relations.length} ・出典 ${state.evidence.length}\n` +
    `一次 ${confCounts.primary} ／ 二次 ${confCounts.secondary} ／ 未確認 ${confCounts.unverified} ／ 参考 ${confCounts.reference}`;
}

function chipNode(entity) {
  const inWeek = state.weekEntityIds.has(entity.id);
  const isBaseline = entity.origin === "baseline";
  const classes = ["pl-chip"];
  if (inWeek) classes.push("is-active-week");
  if (isBaseline) classes.push("is-baseline");

  const badge = inWeek
    ? el("span", { class: "pl-badge-week", text: "今週" })
    : isBaseline
      ? el("span", { class: "pl-badge-baseline", text: "参考" })
      : null;

  return el("a", { class: classes.join(" "), href: `player.html?id=${encodeURIComponent(entity.id)}` }, [
    el("span", { class: "pl-dot", style: `width:8px;height:8px;background:${REGION_COLOR[entity.region] ?? "#999"}` }),
    el("span", { text: entity.name }),
    badge,
  ]);
}

function renderLayers() {
  const container = document.getElementById("layers");
  container.innerHTML = "";

  let visibleEntities = state.entities.filter((e) => state.checkedRegions.has(e.region));
  if (state.onlyThisWeek) visibleEntities = visibleEntities.filter((e) => state.weekEntityIds.has(e.id));
  if (state.query.trim()) {
    const q = state.query.trim().toLowerCase();
    visibleEntities = visibleEntities.filter((e) => e.name.toLowerCase().includes(q));
  }

  const groups = groupByLayer(visibleEntities);
  for (const layer of LAYERS) {
    const items = groups.get(layer.id) ?? [];
    if (items.length === 0) continue;
    // 今週→企業名の順で並べる（モックアップと同じ並び順の意図）
    items.sort((a, b) => {
      const wa = state.weekEntityIds.has(a.id) ? 0 : 1;
      const wb = state.weekEntityIds.has(b.id) ? 0 : 1;
      if (wa !== wb) return wa - wb;
      return a.name.localeCompare(b.name, "ja");
    });

    container.appendChild(
      el("section", { class: "pl-layer-section" }, [
        el("div", { class: "pl-layer-heading" }, [
          el("span", { class: "pl-layer-name", text: layer.label }),
          el("span", { class: "pl-layer-count", text: `${items.length} 件` }),
        ]),
        el("div", { class: "pl-chip-row" }, items.map(chipNode)),
      ])
    );
  }

  if (container.children.length === 0) {
    container.appendChild(el("div", { class: "pl-empty-state", text: "条件に一致する企業がありません。" }));
  }
}

function renderNews() {
  const digest = latestDigest(state.weeklyDigests);
  const list = document.getElementById("news-list");
  const period = document.getElementById("news-period");
  list.innerHTML = "";
  if (!digest) {
    period.textContent = "週次データがまだありません。";
    return;
  }
  period.textContent = `${digest.periodStart} 〜 ${digest.periodEnd.slice(5)} ・トップ10 から`;

  for (const item of digest.top10.slice().sort((a, b) => a.rank - b.rank)) {
    const evidence = state.evidence.find((e) => e.id === item.evidenceId);
    const track = TRACKS.find((t) => t.id === item.track);
    list.appendChild(
      el("li", { class: "pl-news-item" }, [
        el("span", { class: "pl-news-rank", text: String(item.rank) }),
        el("div", { class: "pl-news-body" }, [
          el("span", { class: "pl-news-headline", text: item.headline }),
          el("div", { class: "pl-news-meta" }, [
            el("span", { class: "pl-news-date", text: (evidence ? evidenceDate(evidence) : "").slice(5) }),
            evidence
              ? el("span", { class: `pl-confidence ${evidence.confidence}`, text: CONFIDENCE_LABEL[evidence.confidence] ?? evidence.confidence })
              : null,
            track ? el("span", { class: "pl-track-pill", style: `color:${track.color}`, text: track.label }) : null,
          ]),
        ]),
      ])
    );
  }
}

function renderUpdated() {
  const digest = latestDigest(state.weeklyDigests);
  document.getElementById("updated").textContent = digest
    ? `更新 ${digest.periodEnd}`
    : "";
}

function rerender() {
  renderStats();
  renderLayers();
}

async function main() {
  document.getElementById("layers").innerHTML = '<div class="pl-empty-state">読み込み中...</div>';
  const data = await loadAll();
  Object.assign(state, data);
  state.weekEntityIds = computeWeekEntityIds();

  renderFilters();
  renderUpdated();
  renderNews();
  rerender();

  document.getElementById("q").addEventListener("input", (ev) => {
    state.query = ev.target.value;
    renderLayers();
  });
}

main().catch((err) => {
  console.error(err);
  document.getElementById("layers").innerHTML =
    '<div class="pl-empty-state">データの読み込みに失敗しました。Firestoreにまだデータが同期されていない可能性があります。</div>';
});
