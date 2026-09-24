// 公開前チェック（4項目）＋日付の整合チェック（1項目）。1つでも該当したら書き込みを止める。
// 参照：decisions/2026-09-20-payments-landscape-publication.md 4節、
//       decisions/2026-09-21-payments-landscape-firebase-architecture.md 3節

const ALLOWED_KEYS = {
  entities: new Set(["id", "name", "type", "layers", "region", "origin", "parent", "aliases"]),
  relations: new Set(["id", "from", "to", "kind", "confidence", "tracks", "firstSeenDate", "lastSeenDate", "status", "until"]),
  evidence: new Set([
    "id", "date", "published", "source", "confidence", "entities", "relations", "track",
    "milestones", "role", "caution", "summary", "relevantClaims",
  ]),
  weeklyDigests: new Set(["id", "weekId", "periodStart", "periodEnd", "top10"]),
  newsRefs: new Set(["id", "title", "url", "matchedEntity", "publishedAt", "paywalled", "confirmed", "summary"]),
};

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
// 日本の電話番号らしき「0始まり-ハイフン区切り」パターン。
// 日付（例: "2026-08-29-2026-09-04" 中の "08-29-2026"）と衝突しないよう、
// マッチ全体の数字だけを数えて 9〜11桁（実際の電話番号の桁数）のときだけ電話番号とみなす。
const PHONE_CANDIDATE_RE = /0\d{1,4}-\d{1,4}-\d{3,4}/g;
function hasPhoneNumber(text) {
  for (const m of text.matchAll(PHONE_CANDIDATE_RE)) {
    const digits = m[0].replace(/-/g, "");
    if (digits.length >= 9 && digits.length <= 11) return true;
  }
  return false;
}
const WINDOWS_USER_PATH_RE = /[A-Za-z]:\\Users\\[^\\]+/i;
const LOCAL_PATH_RE = /[A-Za-z]:[\\/]work[\\/]/i;

/** 1. 許可リスト外のフィールドが出力に含まれていないか */
function checkAllowedKeys(publicData) {
  const violations = [];
  for (const [collection, docs] of Object.entries(publicData)) {
    const allowed = ALLOWED_KEYS[collection];
    if (!allowed) continue;
    for (const doc of docs) {
      for (const key of Object.keys(doc)) {
        if (!allowed.has(key)) {
          violations.push(`${collection}/${doc.id}: 許可リスト外のフィールド "${key}"`);
        }
      }
    }
  }
  return violations;
}

/** 2. 個人情報の検知（メール・電話・Windowsユーザーパス・ローカルパス） */
function checkPii(publicData) {
  const violations = [];
  for (const [collection, docs] of Object.entries(publicData)) {
    for (const doc of docs) {
      const text = JSON.stringify(doc);
      if (EMAIL_RE.test(text)) violations.push(`${collection}/${doc.id}: メールアドレスらしき文字列を検知`);
      if (hasPhoneNumber(text)) violations.push(`${collection}/${doc.id}: 電話番号らしき文字列を検知`);
      if (WINDOWS_USER_PATH_RE.test(text)) violations.push(`${collection}/${doc.id}: Windowsのユーザーパスを検知`);
      if (LOCAL_PATH_RE.test(text)) violations.push(`${collection}/${doc.id}: ローカルパス（work配下）を検知`);
    }
  }
  return violations;
}

/** 3. 公開禁止語リストとの照合（.private/deny-words.txt。無ければ警告のみでスキップ） */
function checkDenyWords(publicData, denyWords) {
  if (!denyWords.found) {
    return { violations: [], warning: `禁止語リストが見つかりません（${denyWords.path}）。このチェックはスキップされました。` };
  }
  const violations = [];
  for (const [collection, docs] of Object.entries(publicData)) {
    for (const doc of docs) {
      const text = JSON.stringify(doc);
      for (const word of denyWords.words) {
        if (word && text.includes(word)) {
          violations.push(`${collection}/${doc.id}: 禁止語 "${word}" を検知`);
        }
      }
    }
  }
  return { violations, warning: null };
}

/** 4. publish:false の evidence が出力に含まれていないか（buildEvidence側で除外済みのはずの二重チェック） */
function checkPublishFalseExcluded(rawEvidenceList, publicData) {
  const excludedIds = new Set(
    rawEvidenceList.filter((e) => e.frontmatter.publish === false).map((e) => e.id)
  );
  const violations = [];
  if (excludedIds.size === 0) return violations;

  for (const doc of publicData.evidence) {
    if (excludedIds.has(doc.id)) violations.push(`evidence/${doc.id}: publish:false のevidenceが出力に含まれている`);
  }
  for (const digest of publicData.weeklyDigests) {
    for (const item of digest.top10) {
      if (item.evidenceId && excludedIds.has(item.evidenceId)) {
        violations.push(`weeklyDigests/${digest.id}: publish:falseのevidence(${item.evidenceId})を参照している`);
      }
    }
  }
  return violations;
}

/**
 * 5. 日付の形式と整合（データ品質）。画面の週次集計は記事日で行うため、壊れた日付は集計を黙って狂わせる。
 *    - date・published は YYYY-MM-DD の形式であること
 *    - published（記事の公開日）は date（収集日）より後にならないこと（未来の記事を先に収集することはない）
 */
function checkEvidenceDates(publicData) {
  const violations = [];
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  for (const doc of publicData.evidence) {
    if (!DATE_RE.test(String(doc.date ?? ""))) violations.push(`evidence/${doc.id}: date の形式が YYYY-MM-DD ではない`);
    if (doc.published === undefined) continue;
    if (!DATE_RE.test(String(doc.published))) {
      violations.push(`evidence/${doc.id}: published の形式が YYYY-MM-DD ではない`);
    } else if (DATE_RE.test(String(doc.date ?? "")) && doc.published > doc.date) {
      violations.push(`evidence/${doc.id}: published(${doc.published}) が date(${doc.date}) より後になっている`);
    }
  }
  return violations;
}

/**
 * 5項目すべてを実行する。
 * @returns {{ ok: boolean, violations: string[], warnings: string[] }}
 */
export function runPrePublishChecks({ publicData, rawEvidenceList, denyWords }) {
  const violations = [
    ...checkAllowedKeys(publicData),
    ...checkPii(publicData),
    ...checkPublishFalseExcluded(rawEvidenceList, publicData),
    ...checkEvidenceDates(publicData),
  ];
  const denyResult = checkDenyWords(publicData, denyWords);
  violations.push(...denyResult.violations);

  const warnings = [];
  if (denyResult.warning) warnings.push(denyResult.warning);

  return { ok: violations.length === 0, violations, warnings };
}
