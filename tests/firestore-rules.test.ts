import { readFile } from "node:fs/promises";
import test, { after, before } from "node:test";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { repositoryRoot } from "../src/files.js";

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
const skip = emulatorHost ? false : "Firestore emulator is not running";
let environment: RulesTestEnvironment | undefined;

before(async () => {
  if (!emulatorHost) return;
  const [host = "127.0.0.1", portText = "8080"] = emulatorHost.split(":");
  environment = await initializeTestEnvironment({
    projectId: "demo-news-dashboard",
    firestore: {
      host,
      port: Number(portText),
      rules: await readFile(repositoryRoot + "/firestore.rules", "utf8"),
    },
  });
  await environment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "publicReports", "2026-07-12"), { payload: { date: "2026-07-12" } });
    await setDoc(doc(db, "publicDashboard", "index"), { payload: { reports: [] } });
    await setDoc(doc(db, "publicDashboard", "metrics"), { payload: { series: {} } });
    await setDoc(doc(db, "reports", "2026-07-12"), { secret: true });
    await setDoc(doc(db, "runs", "daily-2026-07-12"), { status: "completed" });
  });
});

after(async () => {
  await environment?.cleanup();
});

test("anonymous clients can read only published dashboard documents", { skip }, async () => {
  const db = environment!.unauthenticatedContext().firestore();
  await assertSucceeds(getDoc(doc(db, "publicReports", "2026-07-12")));
  await assertSucceeds(getDoc(doc(db, "publicDashboard", "index")));
  await assertSucceeds(getDoc(doc(db, "publicDashboard", "metrics")));
  await assertFails(getDoc(doc(db, "publicDashboard", "other")));
  await assertFails(getDoc(doc(db, "reports", "2026-07-12")));
  await assertFails(getDoc(doc(db, "runs", "daily-2026-07-12")));
});

test("anonymous clients cannot write published documents", { skip }, async () => {
  const db = environment!.unauthenticatedContext().firestore();
  await assertFails(setDoc(doc(db, "publicReports", "2026-07-13"), { payload: {} }));
  await assertFails(setDoc(doc(db, "publicDashboard", "index"), { payload: {} }));
});
