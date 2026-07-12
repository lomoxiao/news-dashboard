import path from "node:path";
import { FirestoreStore } from "./firestore.js";
import { repositoryRoot, writeJson } from "./files.js";
import { buildPublicIndex } from "./publication.js";

export async function exportPublicJson(): Promise<{ reports: number }> {
  const store = new FirestoreStore();
  const reports = await store.readReports();
  const supplemental = await store.readSupplementalData();
  const legacyIndex = await store.readPublicIndex();

  for (const { report } of reports) {
    await writeJson(path.join(repositoryRoot, "docs", "data", "daily", `${report.date}.json`), report);
  }
  if (supplemental.metricsMaster !== null) {
    await writeJson(path.join(repositoryRoot, "docs", "data", "metrics", "master.json"), supplemental.metricsMaster);
  }
  for (const document of supplemental.metricDaily) {
    await writeJson(path.join(repositoryRoot, "docs", "data", "metrics", "daily", document.fileName), document.payload);
  }
  for (const document of supplemental.themes) {
    await writeJson(path.join(repositoryRoot, "docs", "data", "themes", document.fileName), document.payload);
  }
  for (const document of supplemental.monthly) {
    await writeJson(path.join(repositoryRoot, "docs", "data", "monthly", document.fileName), document.payload);
  }


  const index = buildPublicIndex(reports, legacyIndex);
  await writeJson(path.join(repositoryRoot, "docs", "data", "index.json"), index);
  return { reports: reports.length };
}
