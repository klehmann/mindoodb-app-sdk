/**
 * The test host's two-user mode (`mountHavenTestHost({ twoUsers: true })` or
 * `/__haven-test/?twoUsers=1`): two app frames side by side, each launched by its own
 * mock Haven with its own replica of every database (`automerge: true`, distinct
 * Automerge actors), like two people on two devices. "Auto-sync" (on by default)
 * merges the replicas every two seconds with `syncMockReplicas`; turn it off to keep
 * the edits apart (two devices offline) and press "Sync" to merge them.
 */
import type { MindooDBAppLaunchContext } from "../types";
import {
  mockReplicaDifferences,
  syncMockReplicas,
  type MockMindooDBAppDatabaseDefinition,
} from "./index";
import type { BrowserTestHost, CreateBrowserTestHostOptions } from "./browserTestHost";
import { createMemoryAttachments, isMemoryAttachments } from "./memoryAttachments";

export interface TestHostUser {
  /** Shown above the user's frame. */
  name: string;
  username: string;
}

export const DEFAULT_TEST_HOST_USERS: readonly [TestHostUser, TestHostUser] = [
  { name: "Anna", username: "CN=Anna Test/O=Test" },
  { name: "Ben", username: "CN=Ben Test/O=Test" },
];

/** Window handles of the two-user mode, for Playwright. */
export interface TwoUserTestHost {
  hosts: [BrowserTestHost, BrowserTestHost];
  /** Merge the two replicas now; resolves with the number of documents that changed. */
  sync(): Promise<number>;
  setAutoSync(on: boolean): void;
  /** Documents that differ between the replicas. */
  differences(): number;
}

declare global {
  interface Window {
    /** Set in two-user mode. */
    __havenTwoUsers?: TwoUserTestHost;
  }
}

const STYLE = `
.htu{display:grid;grid-template-rows:auto 1fr;height:100vh;margin:0;font:13px/1.45 system-ui,sans-serif;background:#eef1f7;color:#172033}
.htu *{box-sizing:border-box}
.htu__bar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:8px 12px;border-bottom:1px solid #d7dce8;background:#f8f9fc}
.htu__badge{padding:2px 8px;border-radius:999px;background:#fde68a;color:#713f12;font-weight:600;font-size:11px;letter-spacing:.04em}
.htu button{font:inherit;padding:5px 12px;border-radius:7px;border:1px solid #c9d0e0;background:#fff;cursor:pointer}
.htu__status{font-weight:600}
.htu__panes{display:grid;grid-template-columns:1fr 1fr;gap:1px;background:#d7dce8;min-height:0}
.htu__pane{display:grid;grid-template-rows:auto 1fr;min-height:0;background:#fff}
.htu__pane h2{margin:0;padding:4px 10px;font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:#5b6478;background:#f8f9fc;border-bottom:1px solid #e4e8f1}
.htu iframe{width:100%;height:100%;border:0}
@media (max-width:900px){.htu__panes{grid-template-columns:1fr;grid-template-rows:1fr 1fr}}
`;

/** The same databases for another user: own documents and own attachment store. */
function replicaOf(databases: MockMindooDBAppDatabaseDefinition[]): MockMindooDBAppDatabaseDefinition[] {
  return databases.map((database) => ({
    ...database,
    automerge: true,
    info: structuredClone(database.info),
    documents: database.documents ? structuredClone(database.documents) : undefined,
    ...(database.methods
      ? {
          methods: {
            ...database.methods,
            ...(isMemoryAttachments(database.methods.attachments) ? { attachments: createMemoryAttachments() } : {}),
          },
        }
      : {}),
  }));
}

export function mountTwoUserTestHost(
  options: Omit<CreateBrowserTestHostOptions, "frame"> & {
    container?: HTMLElement;
    title?: string;
    users?: readonly [TestHostUser, TestHostUser];
  },
  createHost: (options: CreateBrowserTestHostOptions) => BrowserTestHost,
): TwoUserTestHost {
  const { container = document.body, title = "Haven test host", users = DEFAULT_TEST_HOST_USERS, ...hostOptions } = options;
  const style = document.createElement("style");
  style.textContent = STYLE;
  document.head.append(style);
  if (container === document.body) document.body.style.margin = "0";

  const root = document.createElement("div");
  root.className = "htu";
  const bar = document.createElement("div");
  bar.className = "htu__bar";
  const badge = document.createElement("span");
  badge.className = "htu__badge";
  badge.textContent = `TEST HOST · TWO USERS · ${title}`;
  const syncButton = document.createElement("button");
  syncButton.type = "button";
  syncButton.textContent = "Sync";
  syncButton.dataset.testid = "haven-two-users-sync";
  const auto = document.createElement("label");
  const autoBox = document.createElement("input");
  autoBox.type = "checkbox";
  autoBox.checked = true;
  autoBox.dataset.testid = "haven-two-users-autosync";
  auto.append(autoBox, " Auto-sync every 2 s");
  const status = document.createElement("span");
  status.className = "htu__status";
  status.dataset.testid = "haven-two-users-status";
  const single = document.createElement("a");
  const singleUrl = new URL(window.location.href);
  singleUrl.searchParams.delete("twoUsers");
  single.href = singleUrl.toString();
  single.textContent = "Single user";
  bar.append(badge, syncButton, auto, status, single);
  const panes = document.createElement("div");
  panes.className = "htu__panes";
  root.append(bar, panes);
  container.replaceChildren(root);

  const databasesA = (hostOptions.databases ?? []).map((database) => ({ ...database, automerge: true }));
  const hosts = users.map((user, index) => {
    const pane = document.createElement("section");
    pane.className = "htu__pane";
    const heading = document.createElement("h2");
    heading.textContent = `${user.name} — replica ${index + 1}`;
    const frame = document.createElement("iframe");
    frame.title = `${title} as ${user.name}`;
    frame.dataset.testid = `haven-two-users-frame-${index + 1}`;
    pane.append(heading, frame);
    panes.append(pane);
    const launchContext: Partial<MindooDBAppLaunchContext> = {
      ...hostOptions.launchContext,
      user: { id: `test-user-${index + 1}`, username: user.username },
    };
    return createHost({
      ...hostOptions,
      frame,
      launchContext,
      databases: index === 0 ? databasesA : replicaOf(databasesA),
      // distinct Automerge actors: the two replicas write concurrently
      automergeActor: index === 0 ? "a11ce000000000000000000000000001" : "b0b00000000000000000000000000002",
    });
  }) as [BrowserTestHost, BrowserTestHost];

  let lastSync: string | null = null;
  const describe = () => {
    const open = mockReplicaDifferences(hosts[0].host, hosts[1].host);
    status.textContent = `${open ? `⚠ ${open} document(s) not synced` : "✓ in sync"} · last sync ${lastSync ?? "never"}`;
    status.style.color = open ? "#b45309" : "#15803d";
  };
  let syncing: Promise<number> | null = null;
  const sync = () => {
    syncing ??= syncMockReplicas(hosts[0].host, hosts[1].host).finally(() => {
      syncing = null;
      lastSync = new Date().toLocaleTimeString();
      describe();
    });
    return syncing;
  };
  syncButton.addEventListener("click", () => void sync());
  let timer: ReturnType<typeof setInterval> | undefined;
  const setAutoSync = (on: boolean) => {
    autoBox.checked = on;
    if (timer) clearInterval(timer);
    timer = on ? setInterval(() => void sync(), 2000) : undefined;
  };
  autoBox.addEventListener("change", () => setAutoSync(autoBox.checked));
  setAutoSync(true);
  setInterval(describe, 500);
  describe();

  const handle: TwoUserTestHost = {
    hosts,
    sync,
    setAutoSync,
    differences: () => mockReplicaDifferences(hosts[0].host, hosts[1].host),
  };
  window.__havenTwoUsers = handle;
  return handle;
}
