// 「企業の関係図」画面の放射状SVG図を作る。
// 外部の可視化ライブラリ（Cytoscape.js等）は使わない
// （2026-09-21の決定：フェーズ1の範囲＝直接の関係のみの表示では、
//   モックアップ自体が中心企業＋直接の関係先を固定角度で配置した手計算のSVGだったため不要と判断した。
//   「2段階先まで」等の多段階表示が必要になった時点で改めて検討する）。

import { REGION_COLOR, LAYER_LABEL, primaryLayer } from "./data.js";

const CENTER_R = 62;
const SATELLITE_R = 36;
const ORBIT_R = 264;
const CANVAS_W = 760;
const CANVAS_H = 720;
const CX = CANVAS_W / 2;
const CY = CANVAS_H / 2;

// 「競合」は特定の系統に紐づかない関係なので、系統色ではなく中立のグレーで描く
// （モックアップのMastercard例でも「競合」の線だけ系統色ではなくグレーだったため、この規則にした）。
const COMPETITOR_COLOR = "#9A9A9A";
const NO_TRACK_COLOR = "#9A9A9A";

// confidenceごとの線種（モックアップの凡例：一次＝実線／二次＝破線／未確認＝点線）。
// referenceはモックアップの凡例に無いが、未確認と同じ扱い（細かい点線）にしている。
const DASH_BY_CONFIDENCE = {
  primary: null,
  secondary: "10 6",
  reference: "3 5",
  unverified: "3 5",
};

function svgEl(tag, attrs = {}) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v !== null && v !== undefined) node.setAttribute(k, v);
  }
  return node;
}

function lineColor(relation, trackById) {
  if (relation.kind === "競合") return COMPETITOR_COLOR;
  const track = relation.tracks?.[0];
  return (track && trackById[track]?.color) || NO_TRACK_COLOR;
}

/**
 * 中心企業＋直接の関係先を放射状に配置したSVGを組み立てる。
 *
 * @param {object} params
 * @param {object} params.centerEntity 中心の企業（entitiesドキュメント）
 * @param {Array<{entity:object, relation:object, recordCount:number}>} params.satellites 直接の関係先（表示順で渡す）
 * @param {Object<string,{id:string,label:string,color:string}>} params.trackById TRACK_BY_ID相当
 * @param {(entityId:string)=>void} [params.onSelectSatellite] 衛星ノード（企業）クリック時
 * @param {(relationId:string)=>void} [params.onSelectEdge] 線クリック時
 * @returns {SVGSVGElement}
 */
export function buildRadialDiagram({ centerEntity, satellites, trackById, onSelectSatellite, onSelectEdge }) {
  const svg = svgEl("svg", {
    width: CANVAS_W,
    height: CANVAS_H,
    viewBox: `0 0 ${CANVAS_W} ${CANVAS_H}`,
    role: "img",
    "aria-label": `${centerEntity.name} を中心とした関係図`,
  });

  const n = satellites.length;
  const positions = satellites.map((s, i) => {
    // 12時の位置から時計回りに均等配置する。
    const angle = -90 + (360 / n) * i;
    const rad = (angle * Math.PI) / 180;
    return { ...s, x: CX + ORBIT_R * Math.cos(rad), y: CY + ORBIT_R * Math.sin(rad) };
  });

  let totalEvidence = 0;

  // 先に線を描く（ノードの下に来るように）
  for (const s of positions) {
    totalEvidence += s.recordCount;
    const color = lineColor(s.relation, trackById);
    const dash = DASH_BY_CONFIDENCE[s.relation.confidence] ?? "3 5";
    const width = Math.min(2 + (s.recordCount - 1) * 2, 8);

    const line = svgEl("line", {
      x1: CX, y1: CY, x2: s.x, y2: s.y,
      stroke: color, "stroke-width": width, "stroke-dasharray": dash,
      "stroke-linecap": "round",
    });
    svg.appendChild(line);

    // クリックしやすくするための当たり判定専用の透明な太い線
    // （見た目の線は細いことがあるため、実際のクリック領域はこちらで広げる）。
    const hitLine = svgEl("line", {
      x1: CX, y1: CY, x2: s.x, y2: s.y,
      stroke: "transparent", "stroke-width": 16,
    });
    hitLine.style.cursor = onSelectEdge ? "pointer" : "default";
    if (onSelectEdge) hitLine.addEventListener("click", () => onSelectEdge(s.relation.id));
    svg.appendChild(hitLine);

    const midX = (CX + s.x) / 2;
    const midY = (CY + s.y) / 2;
    const label = s.relation.kind + (s.recordCount > 1 ? ` ×${s.recordCount}` : "");
    const rectW = Math.max(52, label.length * 13);
    const labelGroup = svgEl("g");
    labelGroup.style.cursor = onSelectEdge ? "pointer" : "default";
    labelGroup.appendChild(svgEl("rect", {
      x: midX - rectW / 2, y: midY - 12, width: rectW, height: 24, rx: 12,
      fill: "#FFFFFF", stroke: color,
    }));
    const text = svgEl("text", {
      x: midX, y: midY + 4, "text-anchor": "middle", "font-size": 12, fill: color,
      "font-family": "Zen Kaku Gothic New, sans-serif", "font-weight": 700,
    });
    text.textContent = label;
    labelGroup.appendChild(text);
    // ラベル（種類＋件数）をクリックしても、線と同じく該当関係をハイライトする。
    if (onSelectEdge) labelGroup.addEventListener("click", () => onSelectEdge(s.relation.id));
    svg.appendChild(labelGroup);
  }

  // 衛星ノード（企業）
  for (const s of positions) {
    const g = svgEl("g");
    g.style.cursor = onSelectSatellite ? "pointer" : "default";
    const circle = svgEl("circle", {
      cx: s.x, cy: s.y, r: SATELLITE_R, fill: "#FFFFFF",
      stroke: REGION_COLOR[s.entity.region] ?? "#999999", "stroke-width": 2,
      "stroke-dasharray": s.entity.origin === "baseline" ? "4 3" : null,
    });
    const name = svgEl("text", {
      x: s.x, y: s.y + 5, "text-anchor": "middle", "font-size": 13, "font-weight": 700,
      fill: "#1C1E24", "font-family": "Zen Kaku Gothic New, sans-serif",
    });
    name.textContent = s.entity.name;
    const layerLabel = svgEl("text", {
      x: s.x, y: s.y + SATELLITE_R + 20, "text-anchor": "middle", "font-size": 11,
      fill: "#5A5E68", "font-family": "Zen Kaku Gothic New, sans-serif",
    });
    layerLabel.textContent = LAYER_LABEL[primaryLayer(s.entity)] ?? "";
    g.append(circle, name, layerLabel);
    if (onSelectSatellite) g.addEventListener("click", () => onSelectSatellite(s.entity.id));
    svg.appendChild(g);
  }

  // 中心ノード（対象企業）
  const centerColor = REGION_COLOR[centerEntity.region] ?? "#333333";
  svg.appendChild(svgEl("circle", { cx: CX, cy: CY, r: CENTER_R, fill: centerColor }));
  const centerName = svgEl("text", {
    x: CX, y: CY - 2, "text-anchor": "middle", "font-size": 17, "font-weight": 700,
    fill: "#FFFFFF", "font-family": "Zen Kaku Gothic New, sans-serif",
  });
  centerName.textContent = centerEntity.name;
  const centerMeta = svgEl("text", {
    x: CX, y: CY + 18, "text-anchor": "middle", "font-size": 11, fill: "#DCE6F2",
    "font-family": "Zen Kaku Gothic New, sans-serif",
  });
  centerMeta.textContent = `関係 ${n} ・出典延べ ${totalEvidence}`;
  svg.append(centerName, centerMeta);

  return svg;
}
