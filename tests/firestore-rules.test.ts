import { readFile } from "node:fs/promises";
import test, { after, before } from "node:test";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { deleteDoc, doc, getDoc, setDoc, updateDoc } from "firebase/firestore";
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
    await setDoc(doc(db, "access", "owner-uid"), { grantedAt: "2026-07-12T00:00:00Z" });
    await setDoc(doc(db, "dashboardEvents", "owner-uid", "events", "seeded"), validEvent());
    await setDoc(doc(db, "interestAggregates", "2026-W28"), { payload: { funnel: {} } });
    await setDoc(doc(db, "interestProposals", "p1"), {
      kind: "add_keyword", theme: "最新AI情報", value: "ローカルLLM", decision: "pending",
    });
  });
});

function validEvent() {
  return { v: 1, ts: 1770000000000, date: "2026-07-12", action: "expand", articleId: "abc123", theme: "最新AI情報" };
}

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

test("only the allowlisted owner can append telemetry events", { skip }, async () => {
  const anon = environment!.unauthenticatedContext().firestore();
  const owner = environment!.authenticatedContext("owner-uid").firestore();
  const stranger = environment!.authenticatedContext("stranger-uid").firestore();

  await assertFails(setDoc(doc(anon, "dashboardEvents", "owner-uid", "events", "e1"), validEvent()));
  await assertFails(setDoc(doc(stranger, "dashboardEvents", "stranger-uid", "events", "e1"), validEvent()));
  await assertFails(setDoc(doc(stranger, "dashboardEvents", "owner-uid", "events", "e1"), validEvent()));
  await assertSucceeds(setDoc(doc(owner, "dashboardEvents", "owner-uid", "events", "e1"), validEvent()));
});

test("telemetry events are schema-validated and append-only", { skip }, async () => {
  const owner = environment!.authenticatedContext("owner-uid").firestore();

  await assertFails(setDoc(doc(owner, "dashboardEvents", "owner-uid", "events", "bad1"),
    { ...validEvent(), action: "purchase" }));
  await assertFails(setDoc(doc(owner, "dashboardEvents", "owner-uid", "events", "bad2"),
    { ...validEvent(), extra: "field" }));
  await assertFails(setDoc(doc(owner, "dashboardEvents", "owner-uid", "events", "bad3"),
    { v: 1, ts: 1770000000000, date: "2026-07-12" }));
  await assertFails(updateDoc(doc(owner, "dashboardEvents", "owner-uid", "events", "seeded"), { action: "expand" }));
  await assertFails(deleteDoc(doc(owner, "dashboardEvents", "owner-uid", "events", "seeded")));
  await assertFails(getDoc(doc(owner, "dashboardEvents", "owner-uid", "events", "seeded")));
});

test("interest outputs are readable only by allowlisted users", { skip }, async () => {
  const anon = environment!.unauthenticatedContext().firestore();
  const owner = environment!.authenticatedContext("owner-uid").firestore();
  const stranger = environment!.authenticatedContext("stranger-uid").firestore();

  await assertSucceeds(getDoc(doc(owner, "interestAggregates", "2026-W28")));
  await assertSucceeds(getDoc(doc(owner, "interestProposals", "p1")));
  await assertFails(getDoc(doc(anon, "interestAggregates", "2026-W28")));
  await assertFails(getDoc(doc(stranger, "interestAggregates", "2026-W28")));
  await assertFails(setDoc(doc(owner, "interestAggregates", "2026-W29"), { payload: {} }));
});

test("proposal decisions can be recorded but nothing else can change", { skip }, async () => {
  const owner = environment!.authenticatedContext("owner-uid").firestore();
  const stranger = environment!.authenticatedContext("stranger-uid").firestore();

  await assertFails(updateDoc(doc(stranger, "interestProposals", "p1"),
    { decision: "approved", decidedAt: "2026-07-12T09:00:00Z" }));
  await assertFails(updateDoc(doc(owner, "interestProposals", "p1"),
    { decision: "approved", decidedAt: "2026-07-12T09:00:00Z", value: "改ざん" }));
  await assertFails(updateDoc(doc(owner, "interestProposals", "p1"),
    { decision: "maybe", decidedAt: "2026-07-12T09:00:00Z" }));
  await assertFails(setDoc(doc(owner, "interestProposals", "p2"), { kind: "add_keyword" }));
  await assertFails(deleteDoc(doc(owner, "interestProposals", "p1")));
  await assertSucceeds(updateDoc(doc(owner, "interestProposals", "p1"),
    { decision: "approved", decidedAt: "2026-07-12T09:00:00Z" }));
});
