// 「関係の履歴」画面（edge.html）のロジック。
// URLクエリ：?rel=<relations.id>（from__to__kind の形式）＆via=<どのPlayer画面から来たか、任意>
import { loadAll, indexById, evidenceDate, TRACK_BY_ID, CONFIDENCE_LABEL } from "./data.js";

// 「現在の状態」4段階（mockup由来。evidenceのroleフィールドで表す想定だが、
// 現時点ではVaultのどのevidenceもroleを書いていないため、実データがある時だけ表示する
// ＝roleを使うevidenceが1件も無い関係では、このブロックごと非表示にする）。
const STAGE_ORDER = ["噂", "発表", "稼働", "終了"];

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

function renderEmpty(message) {
  const root = document.getElementById("edge-root");
  root.innerHTML = "";
  root.appendChild(el("div", { class: "pl-empty-state", text: message }));
}

function evidenceForRelation(relation, evidenceList) {
  return evidenceList.filter((e) =>
    (e.relations ?? []).some((r) => r.from === relation.from && r.to === relation.to && r.kind === relation.kind)
  );
}

let sortDesc = true; // 新しい順（デフォルト）

function renderRecords(records) {
  const list = document.getElementById("record-list");
  list.innerHTML = "";
  const sorted = records.slice().sort((a, b) => (sortDesc ? (evidenceDate(a) < evidenceDate(b) ? 1 : -1) : evidenceDate(a) > evidenceDate(b) ? 1 : -1));
  for (const ev of sorted) {
    list.appendChild(
      el("li", { class: "pl-record-item" }, [
        el("span", { class: "pl-record-date", text: evidenceDate(ev) }),
        el("div", { class: "pl-record-body" }, [
          el("span", { class: "pl-record-headline", text: ev.summary || "（要約なし）" }),
          el("div", { class: "pl-record-meta" }, [
            el("span", { class: `pl-confidence ${ev.confidence}`, text: CONFIDENCE_LABEL[ev.confidence] ?? ev.confidence }),
            el("span", { class: "id", text: ev.id }),
            ev.source ? el("a", { href: ev.source, target: "_blank", rel: "noopener", text: "出典を開く" }) : null,
          ]),
          ev.caution ? el("span", { class: "pl-record-caution", text: `注意：${ev.caution}` }) : null,
        ]),
      ])
    );
  }
}

async function main() {
  const params = new URLSearchParams(location.search);
  const relId = params.get("rel");
  const viaId = params.get("via");

  if (!relId) {
    renderEmpty("関係が指定されていません。企業の関係図から線を選んでください。");
    return;
  }

  const { entities, relations, evidence } = await loadAll();
  const byId = indexById(entities);
  const relation = relations.find((r) => r.id === relId);
  if (!relation) {
    renderEmpty("指定された関係が見つかりません。");
    return;
  }

  const fromEntity = byId.get(relation.from);
  const toEntity = byId.get(relation.to);
  if (!fromEntity || !toEntity) {
    renderEmpty("関係の相手企業が見つかりません。");
    return;
  }

  const contextEntity = (viaId && byId.get(viaId)) || fromEntity;
  const counterpart = contextEntity.id === relation.from ? toEntity : fromEntity;

  document.title = `${fromEntity.name} → ${toEntity.name}（${relation.kind}） — Payments Landscape`;

  // パンくず
  const breadcrumbVia = document.getElementById("breadcrumb-via");
  breadcrumbVia.textContent = contextEntity.name;
  breadcrumbVia.href = `player.html?id=${encodeURIComponent(contextEntity.id)}`;
  document.getElementById("breadcrumb-current").textContent = `${counterpart.name} との関係`;

  // タイトル・メタ行
  document.getElementById("edge-title").textContent = `${fromEntity.name} → ${toEntity.name} ・${relation.kind}`;

  const records = evidenceForRelation(relation, evidence);
  const track = TRACK_BY_ID[relation.tracks?.[0]];
  const latestConfidence = records.slice().sort((a, b) => (evidenceDate(a) < evidenceDate(b) ? 1 : -1))[0]?.confidence ?? relation.confidence;

  const metaRow = document.getElementById("edge-meta");
  metaRow.innerHTML = "";
  metaRow.append(
    ...[
      track ? el("span", { class: "pl-track-pill", style: `color:${track.color}`, text: track.label }) : null,
      el("span", { text: `記録 ${records.length} 件 ・最新の確度` }),
      el("span", { class: `pl-confidence ${latestConfidence}`, text: CONFIDENCE_LABEL[latestConfidence] ?? latestConfidence }),
    ].filter(Boolean)
  );

  // 現在の状態（roleを使っているevidenceが1件でもあるときだけ表示）
  const withRole = records.filter((e) => e.role && STAGE_ORDER.includes(e.role));
  const stateBlock = document.getElementById("state-block");
  if (withRole.length === 0) {
    stateBlock.style.display = "none";
  } else {
    stateBlock.style.display = "";
    const currentStage = withRole.slice().sort((a, b) => (evidenceDate(a) < evidenceDate(b) ? 1 : -1))[0].role;
    const track2 = document.getElementById("state-track");
    track2.innerHTML = "";
    for (const stage of STAGE_ORDER) {
      track2.appendChild(
        el("div", { class: `pl-state-pill${stage === currentStage ? " is-current" : ""}`, text: stage })
      );
    }
  }

  // 記録一覧
  document.getElementById("sort-toggle").addEventListener("click", () => {
    sortDesc = !sortDesc;
    document.getElementById("sort-toggle").textContent = sortDesc ? "新しい順" : "古い順";
    renderRecords(records);
  });
  renderRecords(records);
}

main().catch((err) => {
  console.error(err);
  renderEmpty("データの読み込みに失敗しました。Firestoreにまだデータが同期されていない可能性があります。");
});
