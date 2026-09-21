// news-dashboard の記事を、Vaultの企業辞書（vocabulary.yaml）と文字照合し、
// 「参考情報」として newsRefs コレクション用のドキュメントを組み立てる。
// LLMは使わない（名前・別名との単純な部分文字列一致のみ）。
// 参照：decisions/2026-09-20-payments-landscape-publication.md 3-2節
//   - Landscape本体（企業・関係・確度）の根拠はpayments-weeklyのevidenceだけとする。
//     news-dashboardの記事からは企業・関係を自動で作らない（=ここではnewsRefsだけを作る）。
//   - 有料媒体（日本経済新聞、NCBライブラリなど）の記事は見出しとリンクまでに留め、要約は表示しない。
//   - 同じ記事がevidenceにもある場合は、URLを正規化した記事IDで突き合わせ「確認済み」として1件にまとめる。

import { createHash } from "node:crypto";

// news-dashboard の対象テーマ。config.json の themes[].name と一致させる。
export const TARGET_THEME = "金融決済";

// 有料購読媒体（本文を引用しない・要約も出さない）。
// 3-2節に明記された媒体名 + config.json の custom_sources ラベルを合わせたもの。
// 新しい有料媒体が増えたら、ここに追記する（機械的な判定はできないため）。
export const PAYWALLED_SOURCES = new Set([
  "日本経済新聞",
  "日経クロステック",
  "NCBライブラリ",
]);

const TRACKING_PARAM_RE = /^(utm_|fbclid$|gclid$|ref$|ref_src$)/i;

/** URLを比較用に正規化する（末尾スラッシュ・トラッキングパラメータ・フラグメントを除去）。 */
export function normalizeUrl(rawUrl) {
  if (!rawUrl) return "";
  try {
    const u = new URL(rawUrl.trim());
    u.hash = "";
    for (const key of [...u.searchParams.keys()]) {
      if (TRACKING_PARAM_RE.test(key)) u.searchParams.delete(key);
    }
    u.searchParams.sort();
    const query = u.searchParams.toString();
    return (u.origin + u.pathname).replace(/\/$/, "").toLowerCase() + (query ? "?" + query : "");
  } catch {
    return rawUrl.trim().toLowerCase();
  }
}

/** 正規化したURLから、Firestoreドキュメント用の短い決定論的IDを作る。 */
function urlHash(normalizedUrl) {
  return createHash("sha256").update(normalizedUrl).digest("hex").slice(0, 16);
}

/**
 * vocabulary.yaml の entities から「名前・別名 -> entity id」の一覧を作る。
 * 1〜1文字の名前は誤検知が多いため対象外にする。
 */
function buildNameIndex(vocabulary) {
  const index = [];
  for (const [id, e] of Object.entries(vocabulary.entities ?? {})) {
    const names = [e.name, ...(e.aliases ?? [])].filter((n) => n && n.length >= 2);
    for (const name of names) index.push({ name, entityId: id });
  }
  // 長い名前を先に判定したいので長さ降順（"三井住友カード"が"カード"のような
  // 短い別名に埋もれて判定順が変な挙動にならないようにするための保険。
  // 現状は「含まれていればヒット」なので判定順は結果に影響しないが、将来
  // 最初の1件だけ採用するロジックに変えるときのために並びだけ揃えておく）。
  index.sort((a, b) => b.name.length - a.name.length);
  return index;
}

/** テキストに含まれる企業名・別名から、マッチしたentity idの集合を返す。 */
function matchEntityIds(text, nameIndex) {
  const ids = new Set();
  for (const { name, entityId } of nameIndex) {
    if (text.includes(name)) ids.add(entityId);
  }
  return ids;
}

/**
 * news-dashboardの日次レポート群から、newsRefsドキュメントの配列を組み立てる。
 * @param {object[]} reports - publicReports/{date} の payload（{date, topics: [...]}）の配列
 * @param {object} vocabulary - loadVocabulary()の戻り値
 * @param {{id:string, source:string}[]} publicEvidence - buildEvidence()済みの公開evidence配列（confirmed判定用）
 * @returns {object[]} newsRefsドキュメントの配列（許可フィールドのみ）
 */
export function buildNewsRefs({ reports, vocabulary, publicEvidence }) {
  const nameIndex = buildNameIndex(vocabulary);
  const confirmedUrls = new Set(
    (publicEvidence ?? []).map((e) => normalizeUrl(e.source)).filter(Boolean)
  );

  const byKey = new Map(); // `${entityId}__${hash}` -> doc（同一記事・同一企業の重複を1件にまとめる）

  for (const report of reports ?? []) {
    for (const topic of report.topics ?? []) {
      if (topic.theme !== TARGET_THEME) continue;
      for (const article of topic.articles ?? []) {
        if (!article.url || !article.title) continue;

        const text = `${article.title} ${article.summary_short ?? ""}`;
        const matchedIds = matchEntityIds(text, nameIndex);
        if (matchedIds.size === 0) continue; // どの企業にも紐付かない記事は載せない

        const normalized = normalizeUrl(article.url);
        const hash = urlHash(normalized);
        const paywalled = PAYWALLED_SOURCES.has(article.source);
        const confirmed = confirmedUrls.has(normalized);

        for (const entityId of matchedIds) {
          const key = `${entityId}__${hash}`;
          if (byKey.has(key)) continue; // 同じ記事が複数日にまたがって出ても1件にする
          byKey.set(key, {
            id: key,
            title: article.title,
            url: article.url,
            matchedEntity: entityId,
            publishedAt: report.date,
            paywalled,
            confirmed,
            // 有料媒体は要約を出さない（見出し＋リンクのみ）。
            summary: paywalled ? null : (article.summary_short ?? null),
          });
        }
      }
    }
  }

  return [...byKey.values()];
}
