// Vault（projects/payments-weekly）から生データを読み込む。
// LLM は使わない。ファイルをそのまま読んでパースするだけ。

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";

/**
 * frontmatter（--- ... ---）と本文を分離する。
 * @returns {{frontmatter: object, body: string}}
 */
function splitFrontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) {
    return { frontmatter: {}, body: text };
  }
  const frontmatter = yaml.load(m[1]) || {};
  const body = m[2] ?? "";
  return { frontmatter, body };
}

/**
 * vocabulary.yaml を読む。
 */
export async function loadVocabulary(vaultProjectDir) {
  const text = await readFile(path.join(vaultProjectDir, "vocabulary.yaml"), "utf8");
  return yaml.load(text);
}

/**
 * evidence/*.md を全件読む。
 * @returns {Array<{id: string, path: string, frontmatter: object, body: string}>}
 */
export async function loadEvidence(vaultProjectDir) {
  const dir = path.join(vaultProjectDir, "evidence");
  const files = (await readdir(dir)).filter((f) => f.endsWith(".md"));
  const out = [];
  for (const file of files) {
    const full = path.join(dir, file);
    const text = await readFile(full, "utf8");
    const { frontmatter, body } = splitFrontmatter(text);
    const id = file.replace(/\.md$/, "");
    out.push({ id, path: full, frontmatter, body });
  }
  return out;
}

/**
 * artifacts/ 配下の週次レポート（YYYY-MM-DD-YYYY-MM-DD-weekly-report.md）を全件読む。
 * ベースライン収集レポート等（type: report だが週次ではないもの）は対象外にする。
 */
export async function loadWeeklyReports(vaultProjectDir) {
  const dir = path.join(vaultProjectDir, "artifacts");
  const files = (await readdir(dir)).filter((f) => /^\d{4}-\d{2}-\d{2}-\d{4}-\d{2}-\d{2}-weekly-report\.md$/.test(f));
  const out = [];
  for (const file of files) {
    const full = path.join(dir, file);
    const text = await readFile(full, "utf8");
    const { frontmatter, body } = splitFrontmatter(text);
    out.push({ id: file.replace(/\.md$/, ""), path: full, frontmatter, body });
  }
  return out;
}

/**
 * ローカルの公開禁止語リストを読む（Vault の Git にもリポジトリにも入れない前提のファイル）。
 * 存在しなければ空配列＋警告フラグを返す（止めない。ただし呼び出し側で警告を出す）。
 */
export async function loadDenyWords(vaultProjectDir) {
  const denyPath = path.join(vaultProjectDir, "..", "..", ".private", "deny-words.txt");
  try {
    const text = await readFile(denyPath, "utf8");
    return {
      found: true,
      path: denyPath,
      words: text
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith("#")),
    };
  } catch (err) {
    if (err.code === "ENOENT") {
      return { found: false, path: denyPath, words: [] };
    }
    throw err;
  }
}
