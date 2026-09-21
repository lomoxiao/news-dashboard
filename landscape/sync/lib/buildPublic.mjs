// Vault の生データから、Firestore の公開コレクション用オブジェクトを組み立てる。
// ここで拾わないフィールドは、Vault側で何を書いても絶対に公開されない（許可リスト方式）。
// 参照：decisions/2026-09-20-payments-landscape-publication.md 2節、
//       decisions/2026-09-21-payments-landscape-firebase-architecture.md 2節

const CONFIDENCE_RANK = { primary: 3, secondary: 2, reference: 1, unverified: 0 };

/**
 * markdown の本文を "## 見出し" ごとのセクションに分割する。
 * @returns {Map<string, string>} 見出し名（trim済み） -> 本文（trim済み）
 */
function splitSections(body) {
  const sections = new Map();
  const parts = body.split(/^##\s+/m).slice(1); // 先頭（見出し前の空文字）を捨てる
  for (const part of parts) {
    const nl = part.indexOf("\n");
    const heading = (nl === -1 ? part : part.slice(0, nl)).trim();
    const content = (nl === -1 ? "" : part.slice(nl + 1)).trim();
    sections.set(heading, content);
  }
  return sections;
}

/** "## Summary" の最初の段落だけを取る（空行区切りの最初のブロック）。 */
function firstParagraph(text) {
  if (!text) return "";
  const block = text.split(/\n\s*\n/)[0] ?? "";
  return block.trim();
}

/**
 * Vault内部の wikiリンク（[[projects/payments-weekly/evidence/xxx]]）を本文から取り除く。
 * 外部の閲覧者には存在しないページへのリンクなので、公開用テキストには残さない。
 * evidenceIdはpublicなevidenceドキュメントのidとしてもう公開されているので、
 * ここでは出典表記の役目は終わっている（entities配列・relations配列・weeklyDigestsのevidenceIdで代替）。
 */
function stripWikiLinks(text) {
  if (!text) return text;
  let out = text;
  // 全角括弧で、中身がwikiリンクと区切り文字だけのブロックを丸ごと除去
  out = out.replace(/（(?:\[\[[^\]]+\]\]|[、,\s])+）/g, "");
  // 半角括弧版も念のため
  out = out.replace(/\((?:\[\[[^\]]+\]\]|[,\s])+\)/g, "");
  // 残った単独のwikiリンクを除去
  out = out.replace(/\[\[[^\]]+\]\]/g, "");
  // 除去で残った空括弧・余分な空白を整理
  out = out.replace(/（\s*）/g, "").replace(/\(\s*\)/g, "");
  out = out.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return out;
}

// ---------------------------------------------------------------- entities

/**
 * vocabulary.yaml の entities を公開用に変換する。
 * 許可フィールド：id・name・type・layers・region・origin（あれば）・parent（あれば）・aliases（あれば）
 */
export function buildEntities(vocabulary) {
  const out = [];
  for (const [id, e] of Object.entries(vocabulary.entities ?? {})) {
    const doc = {
      id,
      name: e.name,
      type: e.type,
      layers: e.layers ?? [],
      region: e.region,
      origin: e.origin ?? "weekly", // 省略時は週次リサーチ由来
    };
    if (e.parent) doc.parent = e.parent;
    if (e.aliases) doc.aliases = e.aliases;
    out.push(doc);
  }
  return out;
}

// ---------------------------------------------------------------- evidence

/**
 * evidence 1件を公開用に変換する。publish:false は呼び出し側で除外済みの前提。
 * 許可フィールド：date・published・source・confidence・entities・relations・track・milestones・role・caution
 * date は収集日、published は記事・発表の公開日（省略可。ベースラインなど記事でない evidence には無い）。
 * 画面は「published があればそれ、なければ date」を記事の日付として使う。
 *              + 本文の Summary 1段落目・Relevant claims
 */
export function buildEvidenceDoc(evidence) {
  const fm = evidence.frontmatter;
  const sections = splitSections(evidence.body);

  const doc = {
    id: evidence.id,
    date: fm.date,
    source: fm.source,
    confidence: fm.confidence,
    entities: fm.entities ?? [],
    relations: fm.relations ?? [],
    track: fm.track ?? "",
    summary: stripWikiLinks(firstParagraph(sections.get("Summary") ?? "")),
    relevantClaims: stripWikiLinks(sections.get("Relevant claims") ?? ""),
  };
  if (fm.published) doc.published = fm.published;
  if (fm.milestones) doc.milestones = fm.milestones;
  if (fm.role) doc.role = fm.role;
  if (fm.caution) doc.caution = fm.caution;
  return doc;
}

export function buildEvidence(evidenceList) {
  return evidenceList
    .filter((e) => e.frontmatter.publish !== false)
    .map(buildEvidenceDoc);
}

// ---------------------------------------------------------------- relations

/**
 * evidence の frontmatter.relations（{from,to,kind} の配列）を
 * (from,to,kind) 単位に集約し、confidence・tracks・firstSeenDate・lastSeenDate を導出する。
 *
 * 集約ルール（このスクリプトの実装判断。ADRに明記が無いため、ここに理由を書く）：
 * - confidence は、その関係を裏付ける evidence のうち最も強いもの
 *   （primary > secondary > reference > unverified）を採用する。
 * - tracks は、裏付ける evidence の track（空文字は除く）の和集合。
 * - firstSeenDate / lastSeenDate は、裏付ける evidence の記事日（published があればそれ、なければ date）の
 *   最小 / 最大（"YYYY-MM-DD" 形式なので文字列比較で安全に min/max が取れる）。
 */
export function buildRelations(evidenceList) {
  const byKey = new Map(); // "from|to|kind" -> { from, to, kind, confidence, tracks:Set, dates:[] }

  for (const evidence of evidenceList) {
    if (evidence.frontmatter.publish === false) continue;
    const relations = evidence.frontmatter.relations ?? [];
    const date = evidence.frontmatter.published ?? evidence.frontmatter.date;
    const track = evidence.frontmatter.track;
    const confidence = evidence.frontmatter.confidence;

    for (const rel of relations) {
      if (!rel || !rel.from || !rel.to || !rel.kind) continue;
      const key = `${rel.from}|${rel.to}|${rel.kind}`;
      if (!byKey.has(key)) {
        byKey.set(key, {
          from: rel.from,
          to: rel.to,
          kind: rel.kind,
          confidence,
          tracks: new Set(),
          dates: [],
        });
      }
      const agg = byKey.get(key);
      if ((CONFIDENCE_RANK[confidence] ?? -1) > (CONFIDENCE_RANK[agg.confidence] ?? -1)) {
        agg.confidence = confidence;
      }
      if (track) agg.tracks.add(track);
      if (date) agg.dates.push(date);
    }
  }

  const out = [];
  for (const [key, agg] of byKey.entries()) {
    const dates = agg.dates.slice().sort();
    out.push({
      id: key.replace(/\|/g, "__"),
      from: agg.from,
      to: agg.to,
      kind: agg.kind,
      confidence: agg.confidence,
      tracks: [...agg.tracks],
      firstSeenDate: dates[0] ?? null,
      lastSeenDate: dates[dates.length - 1] ?? null,
    });
  }
  return out;
}

// ---------------------------------------------------------------- weeklyDigests

const TITLE_RE = /対象期間\s*(\d{4}-\d{2}-\d{2})\s*[〜~]\s*(\d{4}-\d{2}-\d{2})/;
const ROUND_RE = /第\s*(\d+)\s*回/;
const TOP10_HEADING_RE = /^##\s+トップ10\s*$/m;
const EVIDENCE_LINK_RE = /\[\[projects\/payments-weekly\/evidence\/([^\]]+)\]\]/;

/**
 * 週次レポート1件を weeklyDigests の1ドキュメントに変換する。
 * 許可フィールド：対象期間・top10（順位・evidence id・track・見出しと事実の段落）
 * 「提案への効き」は本文から機械的に除外する（見出し語で判定）。
 *
 * @param {object} report loadWeeklyReports() の1要素
 * @param {Map<string,object>} evidenceById buildEvidenceDoc 済みのevidence（id -> doc）。
 *        trackの補完に使う（週次レポート本文にはtrackが直接書かれていないため）。
 */
export function buildWeeklyDigest(report, evidenceById) {
  const titleMatch = report.body.match(TITLE_RE);
  const roundMatch = report.body.match(ROUND_RE);
  if (!titleMatch) {
    throw new Error(`週次レポート ${report.id} から対象期間を抽出できません（フォーマット変更の可能性）`);
  }
  const [, periodStart, periodEnd] = titleMatch;
  const weekId = roundMatch ? `week-${roundMatch[1].padStart(2, "0")}` : periodStart;

  const topSplit = report.body.split(TOP10_HEADING_RE);
  if (topSplit.length < 2) {
    throw new Error(`週次レポート ${report.id} に "## トップ10" が見つかりません`);
  }
  // 次の "## " 見出し（あれば）の手前までがトップ10セクション
  const rest = topSplit[1];
  const nextH2 = rest.search(/^##\s+/m);
  const top10Body = nextH2 === -1 ? rest : rest.slice(0, nextH2);

  // "### N. 見出し（MM-DD）" で分割
  const chunks = top10Body.split(/^###\s+/m).slice(1);
  const top10 = [];
  for (const chunk of chunks) {
    const headingLine = chunk.slice(0, chunk.indexOf("\n"));
    const m = headingLine.match(/^(\d+)\.\s+(.+?)(?:[（(]\d{2}-\d{2}[）)])?\s*$/);
    if (!m) continue;
    const rank = Number(m[1]);
    const headline = m[2].trim();

    // 「提案への効き」段落を除いた本文（事実の段落）
    const factBody = chunk
      .split("\n")
      .filter((line) => !line.includes("提案への効き"))
      .join("\n");

    const evMatch = chunk.match(EVIDENCE_LINK_RE);
    const evidenceId = evMatch ? evMatch[1] : null;
    const track = evidenceId && evidenceById.has(evidenceId) ? evidenceById.get(evidenceId).track : "";

    top10.push({
      rank,
      headline,
      evidenceId,
      track: track || "",
      summary: stripWikiLinks(firstParagraph(factBody.slice(factBody.indexOf("\n") + 1))),
    });
  }

  return { id: weekId, weekId, periodStart, periodEnd, top10 };
}

export function buildWeeklyDigests(reports, evidenceDocs) {
  const evidenceById = new Map(evidenceDocs.map((e) => [e.id, e]));
  return reports.map((r) => buildWeeklyDigest(r, evidenceById));
}
