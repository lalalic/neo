const STORAGE_KEY = "browserWorkspaceManager.v1";
const MIN_POOL_SIZE = 1;
const MAX_POOL_SIZE = 64;

export function normalizeWorkspaceName(value) {
  const name = String(value || "").trim();
  if (!name) throw new Error("Workspace name is required");
  if (name.length > 80) throw new Error("Workspace name must be at most 80 characters");
  return name;
}

export function normalizePoolSize(value, fallback = 8) {
  const number = Number(value ?? fallback);
  if (!Number.isInteger(number) || number < MIN_POOL_SIZE || number > MAX_POOL_SIZE) {
    throw new Error(`Pool size must be an integer between ${MIN_POOL_SIZE} and ${MAX_POOL_SIZE}`);
  }
  return number;
}

function queryString(workspace, role, slot = "") {
  const params = new URLSearchParams({ workspace, role });
  if (slot !== "") params.set("slot", String(slot));
  return params.toString();
}

export class WorkspaceManager {
  constructor(chromeApi) {
    this.chrome = chromeApi;
  }

  idleUrl(workspace, slot) {
    return this.chrome.runtime.getURL(`workspace.html?${queryString(workspace, "idle", slot)}`);
  }

  markerUrl(workspace) {
    return this.chrome.runtime.getURL(`workspace.html?${queryString(workspace, "marker")}`);
  }

  parseManagedUrl(url) {
    try {
      const parsed = new URL(url);
      const own = new URL(this.chrome.runtime.getURL("workspace.html"));
      if (parsed.origin !== own.origin || parsed.pathname !== own.pathname) return null;
      return {
        workspace: parsed.searchParams.get("workspace") || "",
        role: parsed.searchParams.get("role") || "",
        slot: parsed.searchParams.get("slot") || "",
      };
    } catch {
      return null;
    }
  }

  async loadConfig() {
    const stored = (await this.chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY];
    return stored && typeof stored === "object" ? stored : { workspaces: {} };
  }

  async saveConfig(config) {
    await this.chrome.storage.local.set({ [STORAGE_KEY]: config });
  }

  async configuredWorkspace(name) {
    const config = await this.loadConfig();
    return { config, entry: config.workspaces[name] || null };
  }

  async setPoolSize(name, poolSize) {
    const { config, entry } = await this.configuredWorkspace(name);
    config.workspaces[name] = { ...(entry || {}), poolSize };
    await this.saveConfig(config);
  }

  async removeConfig(name) {
    const config = await this.loadConfig();
    delete config.workspaces[name];
    await this.saveConfig(config);
  }

  async markerTab(name) {
    const tabs = await this.chrome.tabs.query({});
    const candidates = tabs.filter((tab) => {
      const meta = this.parseManagedUrl(tab.url || "");
      return meta?.workspace === name && meta.role === "marker";
    });
    return candidates.length === 1 ? candidates[0] : null;
  }

  async groupTabs(groupId) {
    if (!Number.isInteger(groupId) || groupId < 0) return [];
    return await this.chrome.tabs.query({ groupId });
  }

  classify(name, tabs) {
    const marker = [];
    const idle = [];
    const leased = [];
    for (const tab of tabs) {
      const meta = this.parseManagedUrl(tab.url || "");
      if (meta?.workspace === name && meta.role === "marker") marker.push(tab);
      else if (meta?.workspace === name && meta.role === "idle") idle.push(tab);
      else leased.push(tab);
    }
    return { marker, idle, leased };
  }

  async createGroup(name, poolSize) {
    const created = [];
    created.push(await this.chrome.tabs.create({ url: this.markerUrl(name), active: false }));
    for (let slot = 0; slot < poolSize; slot += 1) {
      created.push(await this.chrome.tabs.create({ url: this.idleUrl(name, slot), active: false }));
    }
    const groupId = await this.chrome.tabs.group({ tabIds: created.map((tab) => tab.id) });
    await this.chrome.tabGroups.update(groupId, { title: name, collapsed: true });
    return await this.status(name);
  }

  async ensureWorkspace(name, poolSize = null) {
    const normalizedName = normalizeWorkspaceName(name);
    const { entry } = await this.configuredWorkspace(normalizedName);
    const wanted = normalizePoolSize(poolSize, entry?.poolSize ?? 8);
    if (!entry || entry.poolSize !== wanted) await this.setPoolSize(normalizedName, wanted);

    const marker = await this.markerTab(normalizedName);
    if (!marker || !Number.isInteger(marker.groupId) || marker.groupId < 0) {
      return await this.createGroup(normalizedName, wanted);
    }
    await this.chrome.tabGroups.update(marker.groupId, { title: normalizedName, collapsed: true });
    await this.reconcilePool(normalizedName, marker.groupId, wanted);
    return await this.status(normalizedName);
  }

  async reconcilePool(name, groupId, poolSize) {
    const tabs = await this.groupTabs(groupId);
    const { marker, idle, leased } = this.classify(name, tabs);
    if (marker.length !== 1) throw new Error(`Workspace ${name} lost its marker tab`);

    const usableCount = idle.length + leased.length;
    if (usableCount < poolSize) {
      const added = [];
      for (let slot = usableCount; slot < poolSize; slot += 1) {
        added.push(await this.chrome.tabs.create({ url: this.idleUrl(name, slot), active: false }));
      }
      if (added.length) await this.chrome.tabs.group({ groupId, tabIds: added.map((tab) => tab.id) });
    } else if (usableCount > poolSize && idle.length) {
      const removable = Math.min(idle.length, usableCount - poolSize);
      await this.chrome.tabs.remove(idle.slice(0, removable).map((tab) => tab.id));
    }
    await this.chrome.tabGroups.update(groupId, { title: name, collapsed: true });
  }

  async status(name) {
    const normalizedName = normalizeWorkspaceName(name);
    const { entry } = await this.configuredWorkspace(normalizedName);
    if (!entry) return { name: normalizedName, initialized: false };

    const marker = await this.markerTab(normalizedName);
    if (!marker || !Number.isInteger(marker.groupId) || marker.groupId < 0) {
      return {
        name: normalizedName,
        initialized: false,
        poolSize: entry.poolSize,
        reason: "marker-missing",
      };
    }
    const tabs = await this.groupTabs(marker.groupId);
    const classified = this.classify(normalizedName, tabs);
    return {
      name: normalizedName,
      initialized: true,
      groupId: marker.groupId,
      poolSize: entry.poolSize,
      markerTabId: marker.id,
      tabIds: classified.idle.concat(classified.leased).map((tab) => tab.id),
      idleTabIds: classified.idle.map((tab) => tab.id),
      leasedTabIds: classified.leased.map((tab) => tab.id),
      tabs: classified.idle.concat(classified.leased).map((tab) => ({
        tabId: tab.id,
        groupId: tab.groupId,
        title: tab.title || "",
        url: tab.url || "",
        active: Boolean(tab.active),
      })),
      collapsed: true,
    };
  }

  async list() {
    const config = await this.loadConfig();
    const result = [];
    for (const name of Object.keys(config.workspaces).sort()) {
      result.push(await this.status(name));
    }
    return { workspaces: result };
  }

  async create(name, poolSize = 8) {
    return await this.ensureWorkspace(name, normalizePoolSize(poolSize));
  }

  async resize(name, poolSize) {
    const normalizedName = normalizeWorkspaceName(name);
    const wanted = normalizePoolSize(poolSize);
    await this.setPoolSize(normalizedName, wanted);
    return await this.ensureWorkspace(normalizedName, wanted);
  }

  async acquire(name, url) {
    const normalizedName = normalizeWorkspaceName(name);
    const parsed = new URL(String(url || ""));
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error("Workspace acquire requires an http(s) URL");
    }
    const ready = await this.ensureWorkspace(normalizedName);
    const tabs = await this.groupTabs(ready.groupId);
    const { idle } = this.classify(normalizedName, tabs);
    if (!idle.length) {
      throw new Error(`Workspace ${normalizedName} pool is exhausted at size ${ready.poolSize}`);
    }
    const tab = idle[0];
    const updated = await this.chrome.tabs.update(tab.id, { url: parsed.href, active: false });
    await this.chrome.tabGroups.update(ready.groupId, { title: normalizedName, collapsed: true });
    return {
      workspace: normalizedName,
      groupId: ready.groupId,
      tabId: updated.id,
      url: updated.url || parsed.href,
      active: Boolean(updated.active),
    };
  }

  async release(name, tabId) {
    const normalizedName = normalizeWorkspaceName(name);
    const ready = await this.ensureWorkspace(normalizedName);
    const wanted = Number(tabId);
    const tabs = await this.groupTabs(ready.groupId);
    const { marker, idle, leased } = this.classify(normalizedName, tabs);
    if (marker.some((tab) => tab.id === wanted)) throw new Error("Cannot release workspace marker tab");
    if (!leased.some((tab) => tab.id === wanted) && !idle.some((tab) => tab.id === wanted)) {
      throw new Error(`Tab ${wanted} is not owned by workspace ${normalizedName}`);
    }

    const usableCount = idle.length + leased.length;
    if (usableCount > ready.poolSize) {
      await this.chrome.tabs.remove(wanted);
    } else {
      await this.chrome.tabs.update(wanted, { url: this.idleUrl(normalizedName, wanted), active: false });
    }
    await this.chrome.tabGroups.update(ready.groupId, { title: normalizedName, collapsed: true });
    return { workspace: normalizedName, tabId: wanted, released: true };
  }

  async delete(name, force = false) {
    const normalizedName = normalizeWorkspaceName(name);
    const state = await this.status(normalizedName);
    if (!state.initialized) {
      await this.removeConfig(normalizedName);
      return { name: normalizedName, deleted: true };
    }
    if (state.leasedTabIds.length && !force) {
      throw new Error(`Workspace ${normalizedName} has ${state.leasedTabIds.length} leased tabs`);
    }
    const tabs = await this.groupTabs(state.groupId);
    if (tabs.length) await this.chrome.tabs.remove(tabs.map((tab) => tab.id));
    await this.removeConfig(normalizedName);
    return { name: normalizedName, deleted: true };
  }

  async rpc(request) {
    const method = String(request?.method || "");
    const args = request?.args || {};
    if (method === "workspace.create") return await this.create(args.name, args.poolSize);
    if (method === "workspace.status") return await this.status(args.name);
    if (method === "workspace.list") return await this.list();
    if (method === "workspace.acquire") return await this.acquire(args.name, args.url);
    if (method === "workspace.release") return await this.release(args.name, args.tabId);
    if (method === "workspace.resize") return await this.resize(args.name, args.poolSize);
    if (method === "workspace.delete") return await this.delete(args.name, Boolean(args.force));
    throw new Error(`Unknown workspace method: ${method}`);
  }
}
