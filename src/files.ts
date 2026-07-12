import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { dailyReportSchema, publicIndexSchema, type DailyReport, type PublicIndex } from "./schema.js";

export const repositoryRoot = path.resolve(import.meta.dirname, "..");
const dateFilePattern = /^\d{4}-\d{2}-\d{2}\.json$/;

export async function readJson(filePath: string): Promise<unknown> {
  const source = await readFile(filePath, "utf8");
  const normalized = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
  return JSON.parse(normalized);
}

export async function readDailyReport(filePath: string): Promise<DailyReport> {
  return dailyReportSchema.parse(await readJson(filePath));
}

export async function readPublicIndex(): Promise<PublicIndex> {
  return publicIndexSchema.parse(await readJson(path.join(repositoryRoot, "docs", "data", "index.json")));
}

export async function listDailyReportFiles(): Promise<string[]> {
  const directory = path.join(repositoryRoot, "docs", "data", "daily");
  return (await readdir(directory)).filter((name) => dateFilePattern.test(name)).sort()
    .map((name) => path.join(directory, name));
}

export async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
