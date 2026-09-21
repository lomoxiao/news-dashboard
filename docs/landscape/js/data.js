// Firestoreの公開コレクションを読み、画面で使いやすい形に整えるモジュール。
// entities/relations/evidence/weeklyDigestsはpublicコレクション（誰でも読み取り可）。
// ここでは読み取りのみ行う。書き込みは同期スクリプト（Admin SDK）側の役割。

import { collection, getDocs } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { db } from "./firebase-init.js";

// vocabulary.yaml のレイヤー定義（表示順・ラベル）。
// Vault側のvocabulary.yamlが正本。レイヤーを追加・変更したらここも合わせて直す。
export const LAYERS = [
  { id: "reg", label: "規制・制度" },
  { id: "network", label: "ネットワーク" },
  { id: "issuer", label: "発行・与信" },
  { id: "acq", label: "アクワイアラ・PSP" },
  { id: "wallet", label: "ウォレット・アプリ" },
  { id: "infra", label: "基盤・技術" },
  { id: "merch", label: "事業者・利用側" },
];
export const LAYER_LABEL = Object.fromEntries(LAYERS.map((l) => [l.id, l.label]));

// vocabulary.yaml の系統（track）定義。色はモックアップのデザインに合わせた固定値。
export const TRACKS = [
  { id: "agent", label: "エージェント決済", color: "#6E48A6" },
  { id: "stable", label: "カードネットワークのステーブルコイン関与", color: "#1F6B63" },
  { id: "wallet", label: "ウォレットの相互運用", color: "#A8601A" },
  { id: "realtime", label: "即時決済とクロスボーダー", color: "#2F5A96" },
  { id: "baas", label: "銀行機能の分解", color: "#7E6128" },
  { id: "btob", label: "国内 BtoB・請求書払い", color: "#56722A" },
  { id: "auth", label: "認証・不正対策", color: "#4A5160" },
  { id: "issuerapp", label: "発行体の会員接点・交通", color: "#9C3B55" },
  { id: "infra", label: "決済インフラの刷新", color: "#6A6A6A" },
];
export const TRACK_BY_ID = Object.fromEntries(TRACKS.map((t) => [t.id, t]));

export const REGION_COLOR = { 国内: "#A3462A", 海外: "#2B5A8C" };

const CONFIDENCE_LABEL = { primary: "一次", secondary: "二次", unverified: "未確認", reference: "参考" };
export { CONFIDENCE_LABEL };

async function fetchCollection(name) {
  const snap = await getDocs(collection(db, name));
  return snap.docs.map((d) => d.data());
}

/** 5つの公開コレクションをまとめて取得する。 */
export async function loadAll() {
  const [entities, relations, evidence, weeklyDigests, newsRefs] = await Promise.all([
    fetchCollection("entities"),
    fetchCollection("relations"),
    fetchCollection("evidence"),
    fetchCollection("weeklyDigests"),
    fetchCollection("newsRefs"),
  ]);
  return { entities, relations, evidence, weeklyDigests, newsRefs };
}

/**
 * 指定したentityに関する newsRefs を新しい順に返す（企業ページの「最近の記事」用）。
 * newsRefsはnews-dashboardの記事を企業名で機械的に照合した参考情報であり、
 * Landscape本体（企業・関係・確度）の根拠ではない（決定：2026-09-20 payments-landscape-publication 3-2節）。
 */
export function newsRefsForEntity(newsRefs, entityId) {
  return (newsRefs ?? [])
    .filter((r) => r.matchedEntity === entityId)
    .sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : -1));
}

/** periodEndが最も新しい週次ダイジェストを返す。 */
export function latestDigest(weeklyDigests) {
  if (!weeklyDigests.length) return null;
  return weeklyDigests.slice().sort((a, b) => (a.periodEnd < b.periodEnd ? 1 : -1))[0];
}

/**
 * evidence の「記事・発表の日付」。published（記事の公開日）があればそれ、なければ date。
 * date は収集日なので、週次の集計や画面の日付表示には使わない。ベースラインなど記事でない
 * evidence には published が無く、date（収集日）がそのまま返る。
 */
export function evidenceDate(e) {
  return e.published ?? e.date;
}

/** 対象期間（periodStart〜periodEnd、両端含む）に記事日を持つevidenceの配列。 */
export function evidenceInPeriod(evidence, periodStart, periodEnd) {
  return evidence.filter((e) => {
    const d = evidenceDate(e);
    return d >= periodStart && d <= periodEnd;
  });
}

/** 対象期間内に記事日を持つevidenceが言及するentity idの集合（「今週」動いた企業）。 */
export function entitiesInPeriod(evidence, periodStart, periodEnd) {
  const set = new Set();
  for (const e of evidence) {
    const d = evidenceDate(e);
    if (d >= periodStart && d <= periodEnd) {
      for (const id of e.entities ?? []) set.add(id);
    }
  }
  return set;
}

/** entityの「主なレイヤー」＝layers配列の先頭。 */
export function primaryLayer(entity) {
  return entity.layers?.[0] ?? null;
}

/** レイヤーごとにentityをグルーピングする（LAYERSの表示順を維持）。 */
export function groupByLayer(entities) {
  const groups = new Map(LAYERS.map((l) => [l.id, []]));
  for (const e of entities) {
    const layer = primaryLayer(e);
    if (groups.has(layer)) groups.get(layer).push(e);
  }
  return groups;
}

/** entity id -> entity のMapを作る（相関図などでの参照用）。 */
export function indexById(entities) {
  return new Map(entities.map((e) => [e.id, e]));
}
