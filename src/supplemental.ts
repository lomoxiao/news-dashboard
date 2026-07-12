import { readdir } from "node:fs/promises";
import path from "node:path";
import { readJson, repositoryRoot } from "./files.js";

export interface SupplementalDocument {
  id: string;
  fileName: string;
  payload: unknown;
}

export interface SupplementalData {
  metricsMaster: unknown | null;
  metricDaily: SupplementalDocument[];
  themes: SupplementalDocument[];
  monthly: SupplementalDocument[];
}

export async function loadSupplementalData(): Promise<SupplementalData> {
  return {
    metricsMaster: await readOptional(path.join(repositoryRoot, "docs", "data", "metrics", "master.json")),
    metricDaily: await readDirectory(path.join(repositoryRoot, "docs", "data", "metrics", "daily")),
    themes: await readDirectory(path.join(repositoryRoot, "docs", "data", "themes")),
    monthly: await readDirectory(path.join(repositoryRoot, "docs", "data", "monthly")),
  };
}

export function supplementalCount(data: SupplementalData): number {
  return (data.metricsMaster === null ? 0 : 1) + data.metricDaily.length + data.themes.length + data.monthly.length;
}

async function readDirectory(directory: string): Promise<SupplementalDocument[]> {
  let names: string[];
  try {
    names = await readdir(directory);
  } catch {
    return [];
  }
  const documents: SupplementalDocument[] = [];
  for (const fileName of names.filter((name) => name.endsWith(".json")).sort()) {
    documents.push({
      id: fileName.slice(0, -5),
      fileName,
      payload: await readJson(path.join(directory, fileName)),
    });
  }
  return documents;
}

async function readOptional(filePath: string): Promise<unknown | null> {
  try {
    return await readJson(filePath);
  } catch {
    return null;
  }
}
