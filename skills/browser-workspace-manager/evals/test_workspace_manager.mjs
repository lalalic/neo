import assert from "node:assert/strict";
import test from "node:test";

import { WorkspaceManager } from "../extension/workspace-manager.mjs";

function fakeChrome() {
  let nextTabId = 1;
  let nextGroupId = 100;
  const tabs = new Map();
  const groups = new Map();
  const storage = {};

  function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  }

  const api = {
    runtime: {
      getURL(path) {
        return `chrome-extension://test-extension/${path}`;
      },
    },
    storage: {
      local: {
        async get(key) {
          return { [key]: clone(storage[key]) };
        },
        async set(values) {
          Object.assign(storage, clone(values));
        },
      },
    },
    tabs: {
      async query(query = {}) {
        let values = [...tabs.values()];
        if (Number.isInteger(query.groupId)) {
          values = values.filter((tab) => tab.groupId === query.groupId);
        }
        return values.map(clone);
      },
      async create(options) {
        const tab = {
          id: nextTabId++,
          groupId: -1,
          title: "Browser Workspace",
          url: options.url || "about:blank",
          active: Boolean(options.active),
        };
        tabs.set(tab.id, tab);
        return clone(tab);
      },
      async group(options) {
        const groupId = Number.isInteger(options.groupId) ? options.groupId : nextGroupId++;
        if (!groups.has(groupId)) {
          groups.set(groupId, { id: groupId, title: "", collapsed: false });
        }
        for (const tabId of options.tabIds || []) {
          const tab = tabs.get(tabId);
          if (!tab) throw new Error(`Unknown tab ${tabId}`);
          tab.groupId = groupId;
        }
        return groupId;
      },
      async update(tabId, options) {
        const tab = tabs.get(tabId);
        if (!tab) throw new Error(`Unknown tab ${tabId}`);
        if (options.url !== undefined) tab.url = options.url;
        if (options.active !== undefined) tab.active = Boolean(options.active);
        return clone(tab);
      },
      async remove(tabIds) {
        for (const tabId of Array.isArray(tabIds) ? tabIds : [tabIds]) {
          tabs.delete(tabId);
        }
      },
    },
    tabGroups: {
      async update(groupId, options) {
        const group = groups.get(groupId) || { id: groupId, title: "", collapsed: false };
        Object.assign(group, options);
        groups.set(groupId, group);
        return clone(group);
      },
    },
    __moveWorkspaceToNewGroup(name, groupId) {
      const prefix = `chrome-extension://test-extension/workspace.html?workspace=${encodeURIComponent(name)}`;
      const marker = [...tabs.values()].find((tab) => tab.url.startsWith(prefix) && tab.url.includes("role=marker"));
      if (!marker) throw new Error("marker missing");
      const oldGroup = marker.groupId;
      for (const tab of tabs.values()) {
        if (tab.groupId === oldGroup) tab.groupId = groupId;
      }
      const old = groups.get(oldGroup) || { title: name, collapsed: true };
      groups.delete(oldGroup);
      groups.set(groupId, { ...old, id: groupId });
    },
  };
  return api;
}

test("multiple workspaces keep independent pool sizes", async () => {
  const chrome = fakeChrome();
  const manager = new WorkspaceManager(chrome);

  const alpha = await manager.create("Alpha", 2);
  const beta = await manager.create("Beta", 3);

  assert.equal(alpha.poolSize, 2);
  assert.equal(beta.poolSize, 3);
  assert.notEqual(alpha.groupId, beta.groupId);
  assert.equal(alpha.idleTabIds.length, 2);
  assert.equal(beta.idleTabIds.length, 3);

  const leased = await manager.acquire("Alpha", "https://example.com/a");
  assert.ok(alpha.tabIds.includes(leased.tabId));
  assert.equal((await manager.status("Alpha")).leasedTabIds.length, 1);
  assert.equal((await manager.status("Beta")).leasedTabIds.length, 0);

  await manager.release("Alpha", leased.tabId);
  assert.equal((await manager.status("Alpha")).leasedTabIds.length, 0);

  const resized = await manager.resize("Beta", 1);
  assert.equal(resized.poolSize, 1);
  assert.equal(resized.idleTabIds.length, 1);
});

test("workspace identity survives groupId changes through marker reconciliation", async () => {
  const chrome = fakeChrome();
  const manager = new WorkspaceManager(chrome);

  const before = await manager.create("Research", 2);
  chrome.__moveWorkspaceToNewGroup("Research", 777);

  const after = await manager.status("Research");
  assert.equal(after.initialized, true);
  assert.equal(after.groupId, 777);
  assert.equal(after.poolSize, 2);
  assert.notEqual(before.groupId, after.groupId);
});
