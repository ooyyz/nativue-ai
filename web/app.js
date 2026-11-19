// web/code-hierarchy.ts
function codeHierarchy(modules, edges, columns = 2) {
  const byId = new Map(modules.map((m) => [m.id, m]));
  const compare = (a, b) => {
    const left = byId.get(a), right = byId.get(b);
    return (left.symbol || left.name).localeCompare(right.symbol || right.name) || a.localeCompare(b);
  };
  const ids = [...byId.keys()].sort(compare);
  const parents = /* @__PURE__ */ new Map();
  for (const id of ids) {
    const owner = byId.get(id).declaringTypeId;
    if (owner && byId.has(owner) && owner !== id) parents.set(id, { parent: owner, relation: "contains" });
  }
  const candidates = edges.filter((e) => (e.relation === "implements" || e.relation === "extends") && byId.has(e.from) && byId.has(e.to) && e.from !== e.to).sort((a, b) => compare(a.from, b.from) || Number(a.relation !== "implements") - Number(b.relation !== "implements") || compare(a.to, b.to));
  for (const edge of candidates) {
    if (parents.has(edge.from)) continue;
    const visited = /* @__PURE__ */ new Set([edge.from]);
    let cursor = edge.to;
    while (cursor && !visited.has(cursor)) {
      visited.add(cursor);
      cursor = parents.get(cursor)?.parent;
    }
    if (!cursor) parents.set(edge.from, { parent: edge.to, relation: edge.relation });
  }
  for (const id of ids) {
    const visited = /* @__PURE__ */ new Set();
    let cursor = id;
    while (cursor && !visited.has(cursor)) {
      visited.add(cursor);
      cursor = parents.get(cursor)?.parent;
    }
    if (cursor) parents.delete(cursor);
  }
  const children = /* @__PURE__ */ new Map();
  for (const id of ids) {
    const parent = parents.get(id)?.parent;
    if (parent) children.set(parent, [...children.get(parent) || [], id]);
  }
  for (const siblings of children.values()) siblings.sort((a, b) => Number(parents.get(a)?.relation === "contains") - Number(parents.get(b)?.relation === "contains") || compare(a, b));
  const families = [];
  const depths = /* @__PURE__ */ new Map();
  for (const root of ids.filter((id) => !parents.has(id))) {
    const members = [];
    const visit = (id, depth) => {
      members.push(id);
      depths.set(id, depth);
      for (const child of children.get(id) || []) visit(child, depth + 1);
    };
    visit(root, 0);
    families.push({ root, members });
  }
  families.sort((a, b) => Number(b.members.length > 1) - Number(a.members.length > 1) || compare(a.root, b.root));
  const count = Math.max(1, Math.min(4, columns, families.length));
  const inset = (id) => Math.min(depths.get(id) || 0, 6) * 28;
  const laneWidth = 374 + Math.max(0, ...ids.map(inset));
  const bottoms = Array(count).fill(0);
  const positions = /* @__PURE__ */ new Map();
  for (const family of families) {
    const lane = bottoms.indexOf(Math.min(...bottoms));
    family.members.forEach((id, row) => positions.set(id, {
      x: lane * laneWidth + inset(id),
      y: bottoms[lane] + 32 + row * 184
    }));
    bottoms[lane] += 32 + family.members.length * 184 + 24;
  }
  return { positions, parents, families, width: count * laneWidth - 24, height: Math.max(0, ...bottoms) };
}

// src/task-workflow.ts
var taskTransitions = {
  todo: ["developing"],
  developing: ["review"],
  review: ["passed", "rework"],
  rework: ["developing", "review"],
  passed: ["integrated", "rework"],
  integrated: ["integration-review"],
  "integration-review": ["integration-passed", "rework"],
  "integration-passed": ["handtest", "rework"],
  handtest: ["done", "rework"],
  done: []
};
function canEditTaskScope(current, next) {
  return current === "todo" || current === "developing" || current === "rework" && next === "developing";
}

// src/types.ts
var taskProgressOptions = ["todo", "developing", "testing", "done"];

// web/app.ts
var app = document.querySelector("#app");
var esc = (value) => String(value ?? "").replace(
  /[&<>"']/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
);
var data = null;
var lang = localStorage.getItem("nativue-language") || "";
var source = "local";
var tab = "updates";
var viewMode = "map";
var parallelGrouping = "module";
var selectedModule = "";
var selectedTask = "";
var selectedJourney = "";
var journeyStep = -1;
var selectedFile = "";
var search = "";
var related = [];
var relatedOnly = false;
var mapParent = "";
var callRoot = "";
var layoutKey = "";
var mapQuery = "";
var showIndexedDirectories = false;
var canvasGestureActive = false;
var canvasRenderPending = false;
var layoutSaveTimer;
var mapLocations = /* @__PURE__ */ new Map();
var modal = "";
var modalCleanup;
var busy = false;
var error = "";
var toastTimer;
var abortFile;
var initialFit = false;
var boardFitted = false;
var sideWidth = Number(localStorage.getItem("nativue-side-width") || 420);
var text = (en, zh) => lang === "zh" ? zh : en;
var collapsed = /* @__PURE__ */ new Set();
var opened = /* @__PURE__ */ new Set();
var nodePositions = /* @__PURE__ */ new Map();
var groupPositions = /* @__PURE__ */ new Map();
var view = { x: 0, y: 0, scale: 1 };
var boardView = { x: 0, y: 0, scale: 1 };
var stageSize = { width: 900, height: 700 };
var labels = {
  todo: ["Ready", "\u5F85\u5F00\u53D1"],
  developing: ["Developing", "\u5F00\u53D1\u4E2D"],
  review: ["C review", "C \u72EC\u7ACB\u9A8C\u6536"],
  rework: ["Rework", "\u8FD4\u5DE5"],
  passed: ["C passed", "\u5355\u9879\u9A8C\u6536\u901A\u8FC7"],
  integrated: ["Integrated", "\u5DF2\u96C6\u6210"],
  "integration-review": ["Integration review", "\u96C6\u6210\u9A8C\u6536"],
  "integration-passed": ["Integration passed", "\u96C6\u6210\u9A8C\u6536\u901A\u8FC7"],
  handtest: ["Your handtest", "\u5F85\u624B\u6D4B"],
  done: ["Accepted", "\u7528\u6237\u5DF2\u786E\u8BA4"]
};
var statusLabel = (s) => labels[s] ? text(...labels[s]) : s;
var progressLabel = (status) => status === "testing" ? text("Ready for testing", "\u5F85\u6D4B\u8BD5") : status === "done" ? text("Completed", "\u5DF2\u5B8C\u6210") : statusLabel(status);
var taskStatusLabel = (task) => task.progress ? progressLabel(task.progress) : statusLabel(task.status);
var snapshot = () => data ? source === "remote" ? data.remote : data.local : null;
var graphIndexes = /* @__PURE__ */ new WeakMap();
function graphIndex() {
  const s = snapshot();
  if (!s) return void 0;
  const cached = graphIndexes.get(s);
  if (cached) return cached;
  const index = { modules: /* @__PURE__ */ new Map(), children: /* @__PURE__ */ new Map(), incidentEdges: /* @__PURE__ */ new Map() };
  for (const module of s.modules) {
    index.modules.set(module.id, module);
    const parent = module.parentId || "";
    if (!index.children.has(parent)) index.children.set(parent, []);
    index.children.get(parent).push(module);
  }
  for (const edge of s.edges) {
    for (const id of edge.from === edge.to ? [edge.from] : [edge.from, edge.to]) {
      if (!index.incidentEdges.has(id)) index.incidentEdges.set(id, []);
      index.incidentEdges.get(id).push(edge);
    }
  }
  graphIndexes.set(s, index);
  return index;
}
var moduleById = (id) => graphIndex()?.modules.get(id);
var childModules = (id) => graphIndex()?.children.get(id) || [];
function callChainModules() {
  const ids = /* @__PURE__ */ new Set([callRoot]), queue = [{ id: callRoot, depth: 0 }];
  const incidentEdges = graphIndex()?.incidentEdges;
  for (let i = 0; i < queue.length; i++) {
    const { id, depth } = queue[i];
    if (depth >= 2) continue;
    for (const e of incidentEdges?.get(id) || []) {
      if (e.relation !== "calls") continue;
      const next = e.from === id ? e.to : e.from;
      if (next && !ids.has(next) && ids.size < 80) {
        ids.add(next);
        queue.push({ id: next, depth: depth + 1 });
      }
    }
  }
  return snapshot()?.modules.filter((m) => ids.has(m.id)) || [];
}
var isIndexedDirectory = (m) => m.kind === "directory" && /^(?:scan-)?module-[0-9a-f]{12}$/.test(m.id);
function indexedDirectoryCount() {
  if (mapParent || callRoot) return 0;
  const roots = childModules("");
  const count = roots.filter(isIndexedDirectory).length;
  return count < roots.length ? count : 0;
}
function visibleMapModules() {
  const hideIndexedDirectories = !showIndexedDirectories && indexedDirectoryCount() > 0;
  const query = mapQuery.toLowerCase();
  return (callRoot ? callChainModules() : childModules(mapParent)).filter(
    (m) => (!hideIndexedDirectories || !isIndexedDirectory(m)) && (!query || `${m.name} ${m.symbol || ""}`.toLowerCase().includes(query))
  );
}
var scopeKey = () => mapParent + (callRoot ? "#calls:" + callRoot : "");
function rememberMap() {
  clearTimeout(layoutSaveTimer);
  layoutSaveTimer = void 0;
  mapLocations.set(scopeKey(), {
    view: { ...view },
    selectedModule,
    arrangeRevision: mapLocations.get(scopeKey())?.arrangeRevision,
    nodes: new Map(nodePositions),
    groups: new Map(groupPositions),
    collapsed: new Set(collapsed),
    query: mapQuery,
    showIndexedDirectories
  });
  if (!layoutKey) return;
  try {
    localStorage.setItem(layoutKey, JSON.stringify({ parent: mapParent, callRoot, locations: [...mapLocations].map(([id, l]) => [id, { ...l, nodes: [...l.nodes], groups: [...l.groups], collapsed: [...l.collapsed] }]) }));
  } catch {
  }
}
function restoreMap() {
  const key = `nativue-layout:${data?.workspaceId || workspaceTitle()}:${source}`;
  if (layoutKey === key) return;
  layoutKey = key;
  mapLocations.clear();
  try {
    const saved = JSON.parse(localStorage.getItem(key) || "null");
    if (!saved) return;
    for (const [id, l] of saved.locations) {
      if (!l.view || ![l.view.x, l.view.y, l.view.scale].every(Number.isFinite)) continue;
      mapLocations.set(id, { ...l, nodes: new Map(l.nodes), groups: new Map(l.groups), collapsed: new Set(l.collapsed) });
    }
    mapParent = moduleById(saved.parent) ? saved.parent : "";
    callRoot = moduleById(saved.callRoot) ? saved.callRoot : "";
    const location = mapLocations.get(scopeKey());
    if (location) {
      nodePositions.clear();
      groupPositions.clear();
      collapsed.clear();
      for (const [id, p] of location.nodes) nodePositions.set(id, p);
      for (const [id, p] of location.groups) groupPositions.set(id, p);
      for (const id of location.collapsed) collapsed.add(id);
      view = { ...location.view };
      selectedModule = location.selectedModule;
      mapQuery = location.query || "";
      showIndexedDirectories = location.showIndexedDirectories ?? false;
      initialFit = location.showIndexedDirectories !== void 0 || !indexedDirectoryCount();
    }
  } catch {
    mapLocations.clear();
  }
}
function moduleTrail(id) {
  const trail = [], seen = /* @__PURE__ */ new Set();
  let m = moduleById(id);
  while (m && !seen.has(m.id)) {
    trail.unshift(m);
    seen.add(m.id);
    m = moduleById(m.parentId || "");
  }
  return trail;
}
function navigateMap(parent, calls = "", redraw = true) {
  if (parent === mapParent && calls === callRoot) return;
  rememberMap();
  mapParent = parent;
  callRoot = calls;
  const saved = mapLocations.get(scopeKey());
  nodePositions.clear();
  groupPositions.clear();
  collapsed.clear();
  for (const [id, p] of saved?.nodes || []) nodePositions.set(id, p);
  for (const [id, p] of saved?.groups || []) groupPositions.set(id, p);
  for (const id of saved?.collapsed || []) collapsed.add(id);
  view = saved ? { ...saved.view } : { x: 0, y: 0, scale: 1 };
  selectedModule = saved?.selectedModule || calls || parent;
  mapQuery = saved?.query || "";
  showIndexedDirectories = saved?.showIndexedDirectories ?? false;
  selectedTask = "";
  journeyStep = -1;
  tab = "updates";
  initialFit = Boolean(saved && (saved.showIndexedDirectories !== void 0 || !indexedDirectoryCount()));
  if (redraw) {
    render();
    requestAnimationFrame(() => document.getElementById("map-breadcrumbs")?.focus());
  }
}
function renderMapNavigation(moduleCount) {
  const trail = moduleTrail(mapParent);
  const directoryCount = indexedDirectoryCount();
  const directoryToggle = directoryCount ? `<button id="indexed-directories" aria-pressed="${showIndexedDirectories}">${text("Indexed directories", "\u7D22\u5F15\u76EE\u5F55")} \xB7 ${directoryCount}</button>` : "";
  return `<nav id="map-breadcrumbs" class="map-breadcrumbs" tabindex="-1" aria-label="${text("Architecture levels", "\u67B6\u6784\u5C42\u7EA7")}">${mapParent || callRoot ? `<button id="map-up">\u2190 ${text("Back", "\u8FD4\u56DE\u4E0A\u5C42")}</button>` : ""}<ol><li>${mapParent ? `<button data-map-scope="">${text("Main architecture", "\u4E3B\u67B6\u6784")}</button>` : `<span aria-current="page">${text("Main architecture", "\u4E3B\u67B6\u6784")}</span>`}</li>${trail.map((m, i) => `<li><span aria-hidden="true">/</span>${i === trail.length - 1 && !callRoot ? `<span aria-current="page">${esc(m.name)}</span>` : `<button data-map-scope="${esc(m.id)}">${esc(m.name)}</button>`}</li>`).join("")}${callRoot ? `<li><span aria-hidden="true">/</span><span aria-current="page">${text("Call chain \xB7 2 hops \xB7 max 80", "\u8C03\u7528\u94FE \xB7 \u4E24\u8DF3 \xB7 \u6700\u591A 80 \u4E2A\u8282\u70B9")}</span></li>` : ""}</ol><span class="map-scope-count">${moduleCount} ${text("modules", "\u4E2A\u6A21\u5757")}</span>${mapParent ? `<input id="module-search" type="search" aria-label="${text("Find a class or method", "\u67E5\u627E\u7C7B\u6216\u65B9\u6CD5")}" placeholder="${text("Find a class or method", "\u67E5\u627E\u7C7B\u6216\u65B9\u6CD5")}" value="${esc(mapQuery)}">` : ""}${directoryToggle}</nav>`;
}
var formatDate = (v) => v ? new Date(v).toLocaleString(lang === "zh" ? "zh-CN" : "en-US", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit"
}) : text("Never", "\u5C1A\u672A");
var short = (v) => v ? v.slice(0, 9) : "\u2014";
var confidence = (v) => v === "verified" ? text("Verified", "\u5DF2\u9A8C\u8BC1") : v === "inferred" ? text("Inferred", "\u63A8\u65AD") : text("Observed", "\u5DF2\u89C2\u5BDF");
function toast(message) {
  document.querySelector(".toast")?.remove();
  const el = document.createElement("div");
  el.className = "toast";
  el.setAttribute("role", "status");
  el.textContent = message;
  document.body.append(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), 5500);
}
async function api(path, body) {
  const r = await fetch(path, {
    method: body === void 0 ? "GET" : "POST",
    headers: body === void 0 ? {} : { "Content-Type": "application/json" },
    body: body === void 0 ? void 0 : JSON.stringify(body)
  });
  const value = await r.json();
  if (!r.ok)
    throw new Error(value.error || value.message || `HTTP ${r.status}`);
  return value;
}
async function refresh() {
  try {
    const next = await api("/api/state");
    if (canvasGestureActive) {
      canvasRenderPending = true;
      return;
    }
    data = next;
    if (!lang) {
      lang = data.config.language;
      localStorage.setItem("nativue-language", lang);
    }
    const s = snapshot();
    restoreMap();
    if (mapParent && !moduleById(mapParent)) navigateMap("");
    if (callRoot && !moduleById(callRoot)) navigateMap(mapParent);
    if (selectedModule && !moduleById(selectedModule)) selectedModule = "";
    if (selectedFile && !s?.files.some((f) => f.path === selectedFile))
      selectedFile = "";
    related = related.filter((p) => s?.files.some((f) => f.path === p));
    error = "";
    render();
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
    if (data) render();
    else {
      app.innerHTML = `<p class="boot">Nativue AI \xB7 ${esc(error)} <button id="retry">${text("Retry", "\u91CD\u8BD5")}</button></p>`;
      document.querySelector("#retry")?.addEventListener("click", () => void refresh());
    }
  }
}
async function control(action) {
  if (busy) return;
  busy = true;
  render();
  try {
    await api("/api/control", { action, source });
    await refresh();
    toast(
      text(
        "Request received. Check the update status.",
        "\u8BF7\u6C42\u5DF2\u63A5\u6536\uFF0C\u8BF7\u67E5\u770B\u66F4\u65B0\u72B6\u6001\u3002"
      )
    );
  } catch (e) {
    toast(String(e));
  } finally {
    busy = false;
    render();
  }
}
function workspaceTitle() {
  return data?.workspaceName || text("Workspace", "\u5DE5\u4F5C\u533A");
}
function runtimeLabel() {
  const r = data.runtime, s = snapshot();
  return error || r.error ? text("Needs attention", "\u9700\u8981\u5173\u6CE8") : r.paused ? text("Updates paused", "\u66F4\u65B0\u5DF2\u6682\u505C") : r.analyzing ? text("Analyzing changes", "\u6B63\u5728\u5206\u6790\u53D8\u5316") : s?.analysis.status === "complete" ? text("Up to date", "\u5DF2\u66F4\u65B0") : text("Analysis queued", "\u7B49\u5F85\u5206\u6790");
}
var palettes = [
  ["#edf3fa", "#e0eaf6", "#b6cbe0"],
  ["#eef5ef", "#e0ece2", "#bfd3c2"],
  ["#f6f1e8", "#eee5d5", "#d7c9ad"],
  ["#f1eef7", "#e7e1f0", "#ccc0df"],
  ["#eaf4f4", "#dbecec", "#b7d2d2"]
];
function groupTitle(kind) {
  const custom = data?.config.moduleGroups?.find((g) => g.id === kind);
  if (custom) return custom.name;
  const titles = {
    frontend: ["Frontend", "\u524D\u7AEF"],
    backend: ["Backend", "\u540E\u7AEF"],
    shared: ["Shared contracts", "\u5171\u4EAB\u5951\u7EA6"],
    source: ["Source modules", "\u6E90\u7801\u6A21\u5757"],
    documentation: ["Documentation", "\u6587\u6863"],
    test: ["Tests", "\u6D4B\u8BD5"],
    config: ["Configuration", "\u914D\u7F6E"],
    package: ["Packages", "\u8F6F\u4EF6\u5305"],
    application: ["Applications", "\u5E94\u7528"],
    infrastructure: ["Infrastructure", "\u57FA\u7840\u8BBE\u65BD"],
    directory: ["Indexed directories", "\u7D22\u5F15\u76EE\u5F55"]
  };
  return titles[kind] ? text(...titles[kind]) : kind || text("Modules", "\u6A21\u5757");
}
var hierarchyCache = /* @__PURE__ */ new WeakMap();
function hierarchyFor(modules, columns) {
  const s = snapshot();
  if (!s || !modules.length || !modules.every((m) => m.generator === "java" && m.level === "class")) return void 0;
  let cache = hierarchyCache.get(s);
  if (!cache) hierarchyCache.set(s, cache = /* @__PURE__ */ new Map());
  const key = JSON.stringify([columns, modules.map((m) => m.id)]);
  if (!cache.has(key)) cache.set(key, codeHierarchy(modules, s.edges, columns));
  return cache.get(key);
}
function groups() {
  const map = /* @__PURE__ */ new Map();
  for (const m of visibleMapModules()) {
    const k = m.kind || "source";
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(m);
  }
  const entries = [...map];
  const descriptions = new Map(data?.config.moduleGroups?.map((g) => [g.id, g.description]));
  const columns = mapParent ? Math.max(1, Math.min(entries.length, Math.round(Math.sqrt(entries.length * stageSize.width / stageSize.height)))) : Math.max(1, entries.length);
  const nodeColumns = entries.map(([id, modules]) => groupPositions.get(id)?.columns || (mapParent || showIndexedDirectories && id === "directory" ? Math.min(4, Math.max(1, Math.ceil(Math.sqrt(modules.length / 3)))) : 1));
  const hierarchies = entries.map(([, modules], i) => hierarchyFor(modules, nodeColumns[i]));
  const result = [];
  for (const [i, [id, modules]] of entries.entries()) {
    let y = 70;
    for (let row = 0; row < Math.floor(i / columns); row++)
      y += Math.max(...result.slice(row * columns, (row + 1) * columns).map((g) => g.height)) + 55;
    const rowStart = Math.floor(i / columns) * columns;
    const x = 60 + result.slice(rowStart, i).reduce((sum, g) => sum + g.width + 52, 0);
    const p = groupPositions.get(id) || { x, y, columns: nodeColumns[i] };
    const positions = modules.flatMap((m) => {
      const saved = nodePositions.get(m.id);
      return saved ? [{ x: saved.x - p.x, y: saved.y - p.y }] : [];
    });
    const height = collapsed.has(id) ? 108 + (descriptions.get(id) ? 40 : 0) : Math.max(
      285,
      130 + (descriptions.get(id) ? 40 : 0) + (hierarchies[i]?.height ?? Math.ceil(modules.length / nodeColumns[i]) * 164),
      ...positions.map((pos) => pos.y + 164)
    );
    const width = Math.max(
      hierarchies[i] ? hierarchies[i].width + 50 : 368 + (nodeColumns[i] - 1) * 350,
      ...positions.map((pos) => pos.x + 341)
    );
    if (mapParent) groupPositions.set(id, p);
    result.push({
      id,
      title: groupTitle(id),
      description: descriptions.get(id),
      modules: hierarchies[i] ? hierarchies[i].families.flatMap((f) => f.members.map((id2) => moduleById(id2))) : modules,
      color: palettes[i % palettes.length],
      ...p,
      columns: nodeColumns[i],
      width,
      height,
      hierarchy: hierarchies[i]
    });
  }
  return result;
}
function nodePos(m, g, index) {
  const saved = nodePositions.get(m.id);
  if (saved) return saved;
  g = g || groups().find((gr) => gr.modules.some((n) => n.id === m.id));
  const i = index ?? g?.modules.findIndex((n) => n.id === m.id) ?? 0;
  const planned = g?.hierarchy?.positions.get(m.id);
  const position = {
    x: (g?.x || 0) + 25 + (planned?.x ?? i % (g?.columns || 1) * 350) + (m.x || 0),
    y: (g?.y || 0) + 115 + (g?.description ? 40 : 0) + (planned?.y ?? Math.floor(i / (g?.columns || 1)) * 164) + (m.y || 0)
  };
  if (mapParent) {
    while ([...nodePositions.values()].some((p) => p.x === position.x && p.y === position.y)) position.y += 164;
    nodePositions.set(m.id, position);
  }
  return position;
}
function activeModules(gs) {
  if (selectedTask) {
    const task = data?.ledger.tasks.find((t) => t.id === selectedTask);
    return new Set(
      snapshot()?.modules.filter((m) => m.files.some((f) => task?.files.includes(f))).map((m) => m.id) || []
    );
  }
  if (tab === "journeys") {
    const j = currentJourney();
    return new Set(
      journeyStep >= 0 && j?.steps[journeyStep] ? [j.steps[journeyStep].moduleId] : j?.steps.map(
        (st) => moduleTrail(st.moduleId).find((m) => (m.parentId || "") === mapParent)?.id || st.moduleId
      ) || []
    );
  }
  const family = gs.flatMap((g) => g.hierarchy?.families || []).find((f) => f.members.includes(selectedModule));
  return new Set(family?.members || (selectedModule && selectedModule !== mapParent ? [selectedModule] : []));
}
function render() {
  if (canvasGestureActive) {
    canvasRenderPending = true;
    return;
  }
  if (!data) return;
  const arrangeRevision = data.layoutRequests?.[source]?.[scopeKey()];
  if (typeof arrangeRevision === "string" && arrangeRevision && mapLocations.get(scopeKey())?.arrangeRevision !== arrangeRevision) {
    nodePositions.clear();
    groupPositions.clear();
    collapsed.clear();
    mapQuery = "";
    view = { x: 0, y: 0, scale: 1 };
    initialFit = false;
    mapLocations.set(scopeKey(), {
      arrangeRevision,
      view: { ...view },
      selectedModule,
      nodes: /* @__PURE__ */ new Map(),
      groups: /* @__PURE__ */ new Map(),
      collapsed: /* @__PURE__ */ new Set()
    });
  }
  const savedScroll = document.querySelector(".sidebar-scroll")?.scrollTop, inspectorScroll = document.querySelector(".parallel-inspector")?.scrollTop;
  const active = document.activeElement;
  const focusModuleSearch = active?.id === "module-search";
  const focusSearch = active?.id === "file-search", caret = focusSearch ? active.selectionStart : null, focusedTreeFile = active?.dataset.treeFile || "";
  const s = snapshot(), r = data.runtime;
  document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
  document.title = `Tika's Code \xB7 ${workspaceTitle()}`;
  app.innerHTML = `<main class="workspace" style="--side-width:${sideWidth}px"><section class="canvas-shell" aria-label="${text("Development canvas", "\u5F00\u53D1\u753B\u5E03")}">${viewMode === "map" ? renderMap() : renderParallel()}</section><aside class="sidebar" aria-label="${text("Details and navigation", "\u8BF4\u660E\u4E0E\u5BFC\u822A")}"><div id="resize-handle" class="resize-handle" role="separator" aria-orientation="vertical" aria-label="${text("Resize sidebar", "\u8C03\u6574\u53F3\u4FA7\u5BBD\u5EA6")}" aria-valuemin="320" aria-valuemax="720" aria-valuenow="${sideWidth}" tabindex="0"></div><header class="side-header"><h1 title="${esc(workspaceTitle())}">${text("Code & runtime map", "\u4EE3\u7801\u4E0E\u8FD0\u884C\u5730\u56FE")}</h1><select id="version-picker" aria-label="${text("View version", "\u67E5\u770B\u7248\u672C")}"><option value="local" ${source === "local" ? "selected" : ""}>${text("Current workspace", "\u5F53\u524D\u5DE5\u4F5C\u533A")}</option><option value="remote" ${source === "remote" ? "selected" : ""} ${!data.config.remote.enabled ? "disabled" : ""}>${text("Remote branch", "\u8FDC\u7AEF\u5206\u652F")}${data.config.remote.branch ? " \xB7 " + esc(data.config.remote.branch) : ""}</option></select></header><div class="parallel-view-switch" role="group" aria-label="${text("Canvas view", "\u753B\u5E03\u89C6\u56FE")}"><button id="dev-board-open" aria-pressed="${viewMode === "parallel"}">${text("Parallel development", "\u5E76\u884C\u5F00\u53D1")}</button><button id="dev-map-open" aria-pressed="${viewMode === "map"}">${text("Code map", "\u4EE3\u7801\u5730\u56FE")}</button></div><div class="sidebar-tools"><span class="tool-status ${error || r.error ? "error" : ""}" title="${esc(runtimeLabel())}">${esc(runtimeLabel())}</span><button id="refresh-button" title="${text("Update source index", "\u66F4\u65B0\u6E90\u7801\u7D22\u5F15")}" ${busy ? "disabled" : ""}>\u21BB</button><button id="role-button">A/B/C</button><button id="settings-button">${text("Settings", "\u8BBE\u7F6E")}</button><button id="language-button" aria-label="${text("Switch to Chinese", "\u5207\u6362\u5230\u82F1\u6587")}">${lang === "zh" ? "EN" : "\u4E2D\u6587"}</button></div>${viewMode === "parallel" ? `<section class="parallel-inspector" aria-live="polite">${selectedTask ? renderTaskDetail(data.ledger.tasks.find((t) => t.id === selectedTask)) : `<h2>${text("Parallel development", "\u5E76\u884C\u5F00\u53D1")}</h2><p class="empty-text">${text("Click a card for scope, ownership, commits and independent review evidence.", "\u70B9\u51FB\u5361\u7247\u67E5\u770B\u8303\u56F4\u3001\u8BA4\u9886\u3001\u63D0\u4EA4\u548C\u72EC\u7ACB\u9A8C\u6536\u8BC1\u636E\u3002")}</p><button class="primary" id="new-task">\uFF0B ${text("New task", "\u65B0\u5EFA\u4EFB\u52A1")}</button>${renderTaskDetail(void 0)}`}</section>` : `<nav class="tabs" role="tablist" aria-label="${text("Architecture navigation", "\u67B6\u6784\u8F85\u52A9\u5BFC\u822A")}">${["updates", "journeys", "folders"].map((k, i) => `<button id="tab-${k}" role="tab" aria-selected="${tab === k}" tabindex="${tab === k ? 0 : -1}" data-tab="${k}">${[text("Updates", "\u672C\u6B21\u66F4\u65B0"), text("Journeys", "\u64CD\u4F5C\u65C5\u7A0B"), text("Folders", "\u6587\u4EF6\u5939")][i]}</button>`).join("")}</nav>${tab === "journeys" ? renderJourneyNav() : ""}<div class="sidebar-scroll">${renderNotice()}<section id="panel-${tab}" role="tabpanel" aria-labelledby="tab-${tab}">${tab === "updates" ? renderUpdates() : tab === "journeys" ? renderJourneys() : renderFiles()}</section>${tab !== "folders" ? `<section id="selection" class="selection" aria-live="polite">${selectedTask ? renderTaskDetail(data.ledger.tasks.find((t) => t.id === selectedTask)) : selectedModule ? renderModuleDetail(moduleById(selectedModule)) : renderSelectionEmpty()}</section>` : ""}<details class="legend"><summary>${text("Colors, connections & evidence", "\u989C\u8272\u3001\u8FDE\u7EBF\u548C\u9A8C\u8BC1\u8FB9\u754C")}</summary><p class="fine">${text("Group colors show module categories. Solid connections have observed or verified source evidence; dotted ones are inferred. Source analysis is not runtime acceptance.", "\u5927\u6A21\u5757\u5E95\u8272\u533A\u5206\u7C7B\u522B\u3002\u5B9E\u7EBF\u8868\u793A\u6709\u89C2\u5BDF\u6216\u6838\u5BF9\u4F9D\u636E\u7684\u6E90\u7801\u5173\u7CFB\uFF0C\u70B9\u7EBF\u8868\u793A\u63A8\u65AD\u3002\u6E90\u7801\u5206\u6790\u4E0D\u7B49\u4E8E\u8FD0\u884C\u9A8C\u6536\u3002")}</p><p class="fine">${text("Drag cards or group titles. Drag blank space to pan; scroll to zoom. Arrow keys move, +/- zoom, 0 fits the map.", "\u62D6\u52A8\u5361\u7247\u6216\u7EC4\u6807\u9898\uFF1B\u62D6\u52A8\u7A7A\u767D\u5E73\u79FB\uFF0C\u6EDA\u8F6E\u7F29\u653E\u3002\u65B9\u5411\u952E\u79FB\u52A8\uFF0C\u52A0\u51CF\u952E\u7F29\u653E\uFF0C0 \u56DE\u5230\u5168\u56FE\u3002")}</p></details><details class="learning-section"><summary>${text("Version & usage notes", "\u7248\u672C\u4E0E\u4F7F\u7528\u8BF4\u660E")}</summary>${renderVersion()}<p class="fine">${text("Workspace", "\u5DE5\u4F5C\u533A")}: ${esc(workspaceTitle())}<br>${text("AI calls today", "\u4ECA\u65E5 AI \u8C03\u7528")}: ${r.analysisCalls}/${data.config.analysis.maxCallsPerDay}</p><div class="role-buttons"><button id="analysis-button">${text("Analyze", "\u5206\u6790")}</button><button id="pause-button">${r.paused ? text("Resume", "\u6062\u590D") : text("Pause", "\u6682\u505C")}</button>${data.config.remote.enabled ? `<button id="sync-button">${text("Sync remote", "\u540C\u6B65\u8FDC\u7AEF")}</button>` : ""}</div></details></div>`}<footer class="sidebar-footer"><div class="footer-first"><span>Nativue AI \xB7 ${esc(short(s?.source.commit))}${s?.source.dirty ? " \xB7 " + text("modified", "\u6709\u4FEE\u6539") : ""}</span><button class="subtle" id="help-button">${text("Help", "\u4F7F\u7528\u5E2E\u52A9")}</button></div><span class="attribution">\u4E14\u5171\u4ECE\u5BB9</span></footer></aside></main>`;
  bind();
  bindResize();
  bindCanvas(viewMode === "parallel");
  if (savedScroll !== void 0) {
    const el = document.querySelector(".sidebar-scroll");
    if (el) el.scrollTop = savedScroll;
  }
  if (inspectorScroll !== void 0) {
    const el = document.querySelector(".parallel-inspector");
    if (el) el.scrollTop = inspectorScroll;
  }
  if (focusModuleSearch) {
    const input = document.querySelector("#module-search");
    input?.focus();
  }
  if (focusSearch) {
    const el = document.querySelector("#file-search");
    el?.focus();
    if (caret !== null && caret !== void 0)
      el?.setSelectionRange(caret, caret);
  }
  if (focusedTreeFile) {
    requestAnimationFrame(() => {
      const leaf = [
        ...document.querySelectorAll("[data-tree-file]")
      ].find((el) => el.dataset.treeFile === focusedTreeFile);
      if (leaf && selectedFile === focusedTreeFile)
        leaf.focus({ preventScroll: true });
    });
  }
  if (viewMode === "map" && !initialFit && s?.modules.length) {
    initialFit = true;
    requestAnimationFrame(fitGraph);
  }
  if (viewMode === "parallel" && !boardFitted && data.ledger.tasks.length) {
    boardFitted = true;
    requestAnimationFrame(fitBoard);
  }
}
function renderNotice() {
  const s = snapshot(), r = data.runtime;
  let out = "";
  if (error || r.error)
    out += `<div class="notice error" role="alert">${esc(error || r.error)}</div>`;
  if (s?.analysis.error)
    out += `<div class="notice error">${esc(s.analysis.error)}</div>`;
  if (s && s.analysis.status !== "complete")
    out += `<div class="notice">${s.analysis.status === "stale" ? text("Code changed. Showing the last architecture while an update is queued.", "\u4EE3\u7801\u5DF2\u53D8\u5316\uFF0C\u5F53\u524D\u4FDD\u7559\u4E0A\u4E00\u7248\u67B6\u6784\uFF0C\u7B49\u5F85\u589E\u91CF\u5206\u6790\u3002") : text("Source indexed. Architecture explanations are waiting for an Agent.", "\u6E90\u7801\u5DF2\u7D22\u5F15\uFF0C\u67B6\u6784\u8BF4\u660E\u7B49\u5F85 Agent \u5206\u6790\u3002")}<br><button id="notice-analyze">${text("Analyze / create request", "\u5206\u6790 / \u751F\u6210\u8BF7\u6C42")}</button></div>`;
  return out + renderJavaStatus();
}
function renderVersion() {
  const s = snapshot();
  return `<p class="source-version">${text("Source", "\u6765\u6E90")}: ${s?.source.kind === "remote" ? text("Remote", "\u8FDC\u7AEF") : text("Local", "\u672C\u5730")} \xB7 ${esc(s?.source.branch || "\u2014")}<br>${text("Commit", "\u63D0\u4EA4")}: ${esc(s?.source.commit || "\u2014")}<br>${text("Snapshot", "\u5FEB\u7167")}: ${esc(s?.id || "\u2014")}<br>${text("Indexed", "\u7D22\u5F15\u66F4\u65B0")}: ${formatDate(s?.generatedAt)}<br>${text("Semantic update", "\u8BED\u4E49\u66F4\u65B0")}: ${formatDate(s?.analysis.updatedAt)}</p>`;
}
function renderJavaStatus() {
  const j = snapshot()?.java;
  if (!j) return "";
  const c = j.changes;
  return `<details class="java-report" ${j.status === "failed" ? "open" : ""}><summary>${text("Java automatic source graph", "Java \u6E90\u7801\u81EA\u52A8\u5EFA\u56FE")} \xB7 ${j.status === "failed" ? text("Failed \xB7 previous graph retained", "\u5931\u8D25 \xB7 \u4FDD\u7559\u4E0A\u4E00\u6709\u6548\u56FE") : text("Updated", "\u5DF2\u66F4\u65B0")}</summary><p>${text("Parsed / cached / re-resolved files", "\u89E3\u6790 / \u7F13\u5B58\u590D\u7528 / \u5173\u7CFB\u91CD\u7B97\u6587\u4EF6")}: ${j.parsedFiles} / ${j.reusedFiles} / ${j.resolvedFiles}</p><p>${text("Added / changed / removed nodes", "\u65B0\u589E / \u53D8\u5316 / \u5220\u9664\u8282\u70B9")}: ${c.added.length} / ${c.changed.length} / ${c.removed.length}<br>${text("Added / changed / removed relationships", "\u65B0\u589E / \u53D8\u5316 / \u5220\u9664\u5173\u7CFB")}: ${c.addedEdges.length} / ${c.changedEdges.length} / ${c.removedEdges.length}</p>${c.removed.slice(0, 20).map((m) => `<p class="removed-item">\u2212 ${esc(m.name)}</p>`).join("")}${c.removedEdges.slice(0, 20).map((e) => `<p class="removed-item">\u2212 ${esc(e.relation)}: ${esc(e.label)}</p>`).join("")}<p>${text("Unresolved / ambiguous / parser diagnostics", "\u672A\u89E3\u6790 / \u6B67\u4E49 / \u8BED\u6CD5\u8BCA\u65AD")}: ${j.diagnosticCount}</p><div class="java-diagnostics">${j.diagnostics.slice(0, 25).map((d) => `<p><code>${esc(d.path)}:${d.line}</code><br>${esc(d.kind)} \xB7 ${esc(d.message)}</p>`).join("")}</div><p>${text("Feature membership is inferred. Relationships describe declared source targets; reflection, complex call chains and runtime binding remain unresolved.", "\u529F\u80FD\u5F52\u5C5E\u662F\u63A8\u65AD\u3002\u8FDE\u7EBF\u8868\u793A\u6E90\u7801\u58F0\u660E\u76EE\u6807\uFF1B\u53CD\u5C04\u3001\u590D\u6742\u94FE\u5F0F\u8868\u8FBE\u5F0F\u548C\u8FD0\u884C\u65F6\u7ED1\u5B9A\u4ECD\u6709\u89E3\u6790\u8FB9\u754C\u3002")}</p></details>`;
}
var edgeProjections = /* @__PURE__ */ new WeakMap();
function mapEdges(visible) {
  const s = snapshot();
  if (!s) return [];
  const cached = edgeProjections.get(s);
  if (!callRoot && cached?.parent === mapParent && cached.language === lang) return cached.edges;
  const lifted = /* @__PURE__ */ new Map();
  const lift = (id) => {
    if (callRoot) return visible.has(id) ? id : void 0;
    if (!lifted.has(id)) {
      lifted.set(id, moduleTrail(id).find((m) => (m.parentId || "") === mapParent)?.id);
    }
    return lifted.get(id);
  };
  const projected = /* @__PURE__ */ new Map();
  const result = [];
  for (const e of s.edges) {
    if (e.generator !== "java") {
      if (!callRoot) result.push(e);
      continue;
    }
    if (callRoot && e.relation !== "calls") continue;
    const from = lift(e.from), to = lift(e.to);
    if (!from || !to || from === to) continue;
    const key = `${from}:${to}:${e.relation}`;
    const existing = projected.get(key);
    if (existing) {
      existing.count++;
      existing.edge.evidence = [...existing.edge.evidence, ...e.evidence].slice(0, 8);
      if (e.confidence === "inferred") existing.edge.confidence = "inferred";
      if (e.change) existing.edge.change = e.change;
    } else projected.set(key, { edge: { ...e, from, to }, count: 1 });
  }
  const edges = [...result, ...[...projected.values()].map(({ edge, count }) => ({ ...edge, label: edge.label + (count > 1 ? ` \xB7 ${count} ${text("source relationships", "\u6761\u6E90\u7801\u5173\u7CFB")}` : "") }))];
  if (!callRoot) edgeProjections.set(s, { parent: mapParent, language: lang, edges });
  return edges;
}
function typeName(m) {
  const names = { class: ["Class", "\u7C7B"], interface: ["Interface", "\u63A5\u53E3"], enum: ["Enum", "\u679A\u4E3E"], record: ["Record", "\u8BB0\u5F55\u7C7B"] };
  return text(...names[m.typeKind || "class"] || names.class);
}
function typeRelations(m) {
  const relations = [];
  const owner = moduleById(m.declaringTypeId || "");
  if (owner) relations.push({ target: owner, label: text("Declared in", "\u5185\u90E8\u7C7B\u578B\uFF0C\u5C5E\u4E8E") });
  for (const edge of graphIndex()?.incidentEdges.get(m.id) || []) {
    if (edge.from !== m.id || !["implements", "extends"].includes(edge.relation || "")) continue;
    const target = moduleById(edge.to);
    if (target) relations.push({ target, label: edge.relation === "implements" ? text("Implements", "\u5B9E\u73B0") : text("Extends", "\u7EE7\u627F") });
  }
  return relations;
}
function renderTypeBadge(m) {
  if (m.level !== "class" || m.generator !== "java") return "";
  const relations = typeRelations(m).map((r) => r.label + " " + r.target.name).join(" \xB7 ");
  return `<span class="type-relation" title="${esc(relations || m.symbol)}"><strong>${typeName(m)}</strong>${relations ? ` \xB7 ${esc(relations)}` : ""}</span>`;
}
function renderTypeFamilies(g) {
  if (!g.hierarchy || collapsed.has(g.id)) return "";
  const rects = new Map(g.modules.map((m) => [m.id, { ...nodePos(m, g), width: 316, height: 154 }]));
  return g.hierarchy.families.filter((f) => f.members.length > 1).map((f) => {
    const bounds = boundsOf(f.members.map((id) => rects.get(id)), 12);
    if ([...rects].some(([id, r]) => !f.members.includes(id) && r.x < bounds.x + bounds.width && r.x + r.width > bounds.x && r.y < bounds.y + bounds.height && r.y + r.height > bounds.y)) return "";
    return `<div class="type-family" data-type-family="${esc(f.root)}" style="left:${bounds.x - g.x}px;top:${bounds.y - g.y - 20}px;width:${bounds.width}px;height:${bounds.height + 20}px"><span>${text("Code hierarchy", "\u4EE3\u7801\u5C42\u7EA7")} \xB7 ${f.members.length} ${text("types", "\u4E2A\u7C7B\u578B")}</span></div>`;
  }).join("");
}
function typeLinkPath(from, to) {
  const rail = Math.min(from.x, to.x) - 18;
  return `M ${from.x} ${from.y + 77} H ${rail} V ${to.y + 77} H ${to.x - 4}`;
}
function renderMap() {
  const s = snapshot(), gs = groups(), active = activeModules(gs);
  const positions = /* @__PURE__ */ new Map();
  const nodes = gs.map(
    (g, i) => `<section class="group ${collapsed.has(g.id) ? "collapsed" : ""}" data-group-box="${esc(g.id)}" style="left:${g.x}px;top:${g.y}px;width:${g.width}px;height:${g.height}px;--group-bg:${g.color[0]};--group-head:${g.color[1]};--group-line:${g.color[2]}" aria-label="${esc(g.title)}"><div class="group-header"><button class="group-head" data-drag-group="${esc(g.id)}" title="${text("Drag to move group; Alt + arrow keys", "\u62D6\u52A8\u79FB\u52A8\u6574\u7EC4\uFF1BAlt + \u65B9\u5411\u952E\u4E5F\u53EF\u79FB\u52A8")}"><span class="group-no">${String(i + 1).padStart(2, "0")}</span><span class="group-name">${esc(g.title)}</span><span aria-hidden="true">\u283F</span></button><button class="group-toggle" data-group="${esc(g.id)}" aria-label="${text("Expand or collapse", "\u5C55\u5F00\u6216\u6536\u8D77")} ${esc(g.title)}" aria-expanded="${!collapsed.has(g.id)}">${collapsed.has(g.id) ? "\uFF0B" : "\u2212"}</button></div><p class="group-subtitle">${g.modules.length} ${text("modules", "\u4E2A\u6A21\u5757")} \xB7 ${g.modules.reduce((n, m) => n + m.files.length, 0)} ${text("source files", "\u4E2A\u6E90\u6587\u4EF6")}${collapsed.has(g.id) ? " \xB7 " + text("collapsed", "\u5DF2\u6536\u8D77") : ""}</p>${g.description ? `<p class="group-description" title="${esc(g.description)}">${esc(g.description)}</p>` : ""}${!collapsed.has(g.id) ? renderTypeFamilies(g) + g.modules.map((m, j) => {
      const p = nodePos(m, g, j);
      positions.set(m.id, p);
      const childCount = childModules(m.id).length;
      return `<button class="node ${g.hierarchy ? "type-node" : ""} status-${m.confidence === "verified" ? "passed" : m.confidence === "inferred" ? "reference" : "connected"} ${selectedModule === m.id ? "selected" : ""} ${active.size ? active.has(m.id) ? "highlighted" : "dim" : ""}" data-node="${esc(m.id)}" data-change="${m.change || ""}" aria-pressed="${selectedModule === m.id}" title="${childCount ? text("Click for details; double-click to open internal architecture; drag to move", "\u5355\u51FB\u67E5\u770B\u4FE1\u606F\uFF1B\u53CC\u51FB\u8FDB\u5165\u5185\u90E8\u67B6\u6784\uFF1B\u62D6\u52A8\u8C03\u6574\u4F4D\u7F6E") : text("Drag to move; click for details", "\u62D6\u52A8\u8C03\u6574\u4F4D\u7F6E\uFF1B\u70B9\u51FB\u67E5\u770B\u89E3\u91CA")}" style="left:${p.x - g.x}px;top:${p.y - g.y}px"><span class="node-top"><span class="node-id">${String(i + 1).padStart(2, "0")}.${j + 1} \u283F${childCount ? ` \xB7 \u21B3 ${childCount} ${text("submodules", "\u5B50\u6A21\u5757")}` : ""}</span><span class="status-tag">${esc(confidence(m.confidence))}</span></span><span class="node-title">${m.change ? `<small class="change-badge">${m.change === "added" ? text("Added", "\u65B0\u589E") : text("Changed", "\u53D8\u5316")}</small>` : ""}${esc(m.name)}</span>${renderTypeBadge(m)}<span class="node-caption">${esc(m.description || text("Awaiting explanation", "\u7B49\u5F85\u8BF4\u660E"))}</span></button>`;
    }).join("") : ""}</section>`
  ).join("");
  const rects = gs.map((g) => ({
    x: g.x,
    y: g.y,
    width: g.width,
    height: g.height
  }));
  const bounds = boundsOf(rects, 180);
  const edges = mapEdges(new Set(callRoot ? gs.flatMap((g) => g.modules.map((m) => m.id)) : [])).map((e, i) => {
    const ar = positions.get(e.from), br = positions.get(e.to);
    if (!ar || !br) return "";
    const a = moduleById(e.from), b = moduleById(e.to);
    const focus = active.size > 0 && active.has(e.from) && active.has(e.to) || selectedModule && (e.from === selectedModule || e.to === selectedModule);
    return `<path data-from="${esc(e.from)}" data-to="${esc(e.to)}" data-route="${["implements", "extends"].includes(e.relation || "") && a.level === "class" && b.level === "class" ? "type" : "edge"}" data-route-index="${i}" data-change="${e.change || ""}" class="edge ${e.confidence === "inferred" ? "reference" : ""} ${focus ? "active" : active.size ? "dim" : ""}" d="${["implements", "extends"].includes(e.relation || "") && a.level === "class" && b.level === "class" ? typeLinkPath(ar, br) : edgePath(ar, br, i)}"><title>${esc(e.label)} \xB7 ${esc(confidence(e.confidence))}${e.evidence[0] ? " \xB7 " + esc(e.evidence[0].path) + (e.evidence[0].line ? ":" + e.evidence[0].line : "") : ""}</title></path>`;
  }).join("") || "";
  const containment = gs.flatMap((g) => g.modules).map((m) => {
    const owner = moduleById(m.declaringTypeId || "");
    const memberPosition = positions.get(m.id), ownerPosition = positions.get(owner?.id || "");
    if (!owner || !memberPosition || !ownerPosition) return "";
    return `<path class="containment ${active.size && (!active.has(m.id) || !active.has(owner.id)) ? "dim" : ""}" data-owner="${esc(owner.id)}" data-member="${esc(m.id)}" d="${typeLinkPath(ownerPosition, memberPosition)}"><title>${esc(owner.name)} \xB7 ${text("contains", "\u5305\u542B\u5185\u90E8\u7C7B\u578B")} ${esc(m.name)}</title></path>`;
  }).join("");
  return `${renderMapNavigation(gs.reduce((count, group) => count + group.modules.length, 0))}<div id="viewport" class="viewport" tabindex="0" aria-label="${text("Architecture canvas. Drag to pan, scroll to zoom. Arrow keys move, +/- zoom, 0 fits.", "\u67B6\u6784\u753B\u5E03\u3002\u62D6\u52A8\u7A7A\u767D\u79FB\u52A8\uFF0C\u6EDA\u8F6E\u7F29\u653E\uFF1B\u65B9\u5411\u952E\u79FB\u52A8\uFF0C\u52A0\u51CF\u952E\u7F29\u653E\uFF0C0 \u56DE\u5230\u5168\u56FE\u3002")}"><div id="world" class="world" style="transform:translate(${view.x}px,${view.y}px) scale(${view.scale})"><svg class="connections" style="left:${bounds.x}px;top:${bounds.y}px" width="${bounds.width}" height="${bounds.height}" viewBox="${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}" aria-hidden="true"><defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="context-stroke"/></marker></defs>${edges}${containment}</svg><div id="groups">${nodes}</div></div>${!s?.modules.length ? `<div class="map-empty"><h2>${source === "remote" ? text("Remote code map", "\u8FDC\u7AEF\u4EE3\u7801\u5730\u56FE") : text("Start with your code", "\u4ECE\u4F60\u7684\u4EE3\u7801\u5F00\u59CB")}</h2><p>${source === "remote" ? text("Enable and sync your remote to view a separate snapshot.", "\u5F00\u542F\u5E76\u540C\u6B65\u8FDC\u7AEF\u540E\uFF0C\u5373\u53EF\u67E5\u770B\u72EC\u7ACB\u5FEB\u7167\u3002") : text("Ask your Agent to use the Nativue Skill to map modules, evidence and journeys from your indexed code.", "\u8BF7\u8BA9 Agent \u4F7F\u7528 Nativue Skill\uFF0C\u4ECE\u5DF2\u7D22\u5F15\u4EE3\u7801\u5206\u6790\u6A21\u5757\u3001\u6E90\u7801\u8BC1\u636E\u548C\u64CD\u4F5C\u65C5\u7A0B\u3002")}</p><button id="empty-role">${text("Get Agent instructions", "\u83B7\u53D6 Agent \u6307\u4EE4")}</button></div>` : ""}</div><details class="line-legend"><summary>${text("Connection legend", "\u8FDE\u7EBF\u56FE\u4F8B")}</summary><div><span class="line-sample call"></span>${text("Source relationship", "\u6E90\u7801\u5173\u7CFB")}</div><div><span class="line-sample reference"></span>${text("Inferred \xB7 needs verification", "\u63A8\u65AD \xB7 \u5F85\u6838\u5B9E")}</div>${gs.some((g) => g.hierarchy) ? `<div>${text("Brackets without arrows: nested type ownership", "\u65E0\u7BAD\u5934\u62EC\u7EBF\uFF1A\u5185\u90E8\u7C7B\u578B\u5F52\u5C5E")}</div>` : ""}<p>${text("Arrows point to the receiving module. Dark lines indicate the current selection.", "\u7BAD\u5934\u6307\u5411\u63A5\u6536\u65B9\uFF0C\u6DF1\u8272\u8868\u793A\u5F53\u524D\u9AD8\u4EAE\u3002")}</p></details><div class="canvas-bottom"><div class="zoom-controls" role="group" aria-label="${text("Canvas viewport", "\u753B\u5E03\u89C6\u91CE")}"><button id="zoom-out" aria-label="${text("Zoom out", "\u7F29\u5C0F")}">\u2212</button><output id="zoom">${Math.round(view.scale * 100)}%</output><button id="zoom-in" aria-label="${text("Zoom in", "\u653E\u5927")}">\uFF0B</button><span class="divider"></span><button id="fit">${text("Fit all", "\u5168\u56FE")}</button><button id="focus" ${!selectedModule ? "disabled" : ""}>${text("Focus", "\u5B9A\u4F4D\u6240\u9009")}</button><button id="clear">${text("Clear", "\u6E05\u9664\u9AD8\u4EAE")}</button>${gs.some((g) => g.hierarchy) ? `<button id="arrange-code" title="${text("Rearrange the current feature by declared code relationships", "\u6309\u6E90\u7801\u5173\u7CFB\u91CD\u65B0\u6392\u5217\u5F53\u524D\u529F\u80FD\u4E0B\u7684\u7C7B\u578B")}">${text("Arrange code hierarchy", "\u6309\u4EE3\u7801\u5C42\u7EA7\u6392\u5217")}</button>` : ""}<button id="reset-layout">${text("Reset layout", "\u91CD\u7F6E\u5E03\u5C40")}</button></div></div>`;
}
function boundsOf(rects, padding = 0) {
  if (!rects.length) return { x: 0, y: 0, width: 1e3, height: 700 };
  const x = Math.min(...rects.map((r) => r.x)) - padding, y = Math.min(...rects.map((r) => r.y)) - padding;
  return {
    x,
    y,
    width: Math.max(...rects.map((r) => r.x + r.width)) - x + padding,
    height: Math.max(...rects.map((r) => r.y + r.height)) - y + padding
  };
}
function edgePath(a, b, i) {
  const dx = b.x - a.x, dy = b.y - a.y;
  if (Math.abs(dx) > Math.abs(dy) * 0.65) {
    const forward = dx >= 0, ax2 = a.x + (forward ? 316 : 0), bx2 = b.x + (forward ? 0 : 316), ay2 = a.y + 62, by2 = b.y + 62, curve2 = Math.max(40, Math.abs(bx2 - ax2) * 0.45) + i % 3 * 8, sign2 = forward ? 1 : -1;
    return `M${ax2} ${ay2} C${ax2 + sign2 * curve2} ${ay2},${bx2 - sign2 * curve2} ${by2},${bx2} ${by2}`;
  }
  const down = dy >= 0, ax = a.x + 158, bx = b.x + 158, ay = a.y + (down ? 124 : 0), by = b.y + (down ? 0 : 124), curve = Math.max(35, Math.abs(by - ay) * 0.45) + i % 3 * 8, sign = down ? 1 : -1;
  return `M${ax} ${ay} C${ax} ${ay + sign * curve},${bx} ${by - sign * curve},${bx} ${by}`;
}
function taskStage(t) {
  const status = t.progress ?? t.status;
  return status === "done" ? "passed" : status === "rework" ? "rework" : [
    "review",
    "passed",
    "integrated",
    "integration-review",
    "integration-passed",
    "handtest",
    "testing"
  ].includes(status) ? "testing" : status === "developing" ? "confirmed" : "discussion";
}
function dependencyGroups() {
  const tasks = data.ledger.tasks, byId = new Map(tasks.map((t) => [t.id, t])), cache = /* @__PURE__ */ new Map();
  const depth = (id, trail = /* @__PURE__ */ new Set()) => {
    if (cache.has(id)) return cache.get(id);
    const t = byId.get(id);
    if (!t || trail.has(id)) return -1;
    const next = new Set(trail).add(id);
    const deps = t.dependsOn.map((dep) => depth(dep, next));
    const d = deps.some((v) => v < 0) ? -1 : deps.length ? 1 + Math.max(...deps) : 0;
    cache.set(id, d);
    return d;
  };
  const gs = /* @__PURE__ */ new Map();
  for (const t of tasks) {
    const d = depth(t.id);
    if (!gs.has(d)) gs.set(d, []);
    gs.get(d).push(t);
  }
  return [...gs].sort(([a], [b]) => a < 0 ? 1 : b < 0 ? -1 : a - b);
}
function renderParallel() {
  const byDepth = dependencyGroups();
  const hasModules = data.ledger.tasks.some((t) => t.module);
  const byModule = hasModules && parallelGrouping === "module";
  const sortTasks = (a, b) => a.priority.localeCompare(b.priority) || a.id.localeCompare(b.id);
  const sections = byDepth.map(([depth, tasks]) => ({
    key: String(depth),
    title: depth < 0 ? text("Check dependencies", "\u5F85\u6838\u5BF9\u4F9D\u8D56") : text(`Group ${depth + 1}`, `\u7B2C ${depth + 1} \u7EC4`),
    description: depth < 0 ? text("Missing task references or cyclic dependencies. Resolve before scheduling.", "\u4F9D\u8D56\u4EFB\u52A1\u7F3A\u5931\u6216\u5B58\u5728\u73AF\u8DEF\uFF0C\u8BF7\u5148\u6838\u5BF9\u518D\u6D3E\u5DE5\u3002") : depth === 0 ? text("No recorded prerequisites. File ownership still determines safe parallelism.", "\u65E0\u5DF2\u767B\u8BB0\u524D\u7F6E\u4EFB\u52A1\uFF0C\u4ECD\u9700\u6309\u6587\u4EF6\u8BA4\u9886\u5224\u65AD\u662F\u5426\u53EF\u5E76\u884C\u3002") : text("Contains prerequisites in earlier groups. Release each task against its actual dependency evidence.", "\u5305\u542B\u524D\u5E8F\u7EC4\u4F9D\u8D56\uFF0C\u987B\u6309\u6BCF\u9879\u5B9E\u9645\u4F9D\u8D56\u548C\u9A8C\u6536\u8BC1\u636E\u9010\u9879\u653E\u884C\u3002"),
    invalid: depth < 0,
    tasks: tasks.sort(sortTasks)
  }));
  const moduleTasks = /* @__PURE__ */ new Map();
  const invalidSection = sections.find((section) => section.invalid);
  if (byModule) {
    const invalidIds = new Set(invalidSection?.tasks.map((task) => task.id));
    for (const task of data.ledger.tasks) {
      if (invalidIds.has(task.id)) continue;
      const module = task.module?.trim() || "";
      if (!moduleTasks.has(module)) moduleTasks.set(module, []);
      moduleTasks.get(module).push(task);
    }
  }
  const gs = byModule ? [
    ...[...moduleTasks].map(([module, tasks]) => ({
      key: `module:${module}`,
      title: module || text("Other tasks", "\u5176\u4ED6\u4EFB\u52A1"),
      description: "",
      invalid: false,
      tasks
    })),
    ...invalidSection ? [invalidSection] : []
  ] : sections;
  const grouping = hasModules ? `<label>${text("Group by", "\u5206\u7EC4")} <select id="parallel-grouping"><option value="module" ${byModule ? "selected" : ""}>${text("Module", "\u6A21\u5757")}</option><option value="dependency" ${byModule ? "" : "selected"}>${text("Dependencies", "\u4F9D\u8D56")}</option></select></label>` : "";
  return `<section id="parallel-board" class="parallel-board" aria-label="${text("Parallel development canvas", "\u5E76\u884C\u5F00\u53D1\u753B\u5E03")}"><header class="parallel-heading"><h1>${text("Parallel development plan", "\u5E76\u884C\u5F00\u53D1\u8BA1\u5212")}</h1><p>${data.ledger.tasks.length} ${text("tasks \xB7 select a card for ownership and evidence", "\u4E2A\u4EFB\u52A1 \xB7 \u70B9\u5361\u7247\u67E5\u770B\u8303\u56F4\u3001\u5206\u5DE5\u4E0E\u8BC1\u636E")}</p>${grouping}<div class="parallel-legend">${[
    ["discussion", text("Ready", "\u5F85\u5F00\u53D1")],
    ["confirmed", text("Developing", "\u5F00\u53D1\u4E2D")],
    ["testing", text("Testing / review / integration / handtest", "\u6D4B\u8BD5 / \u9A8C\u6536 / \u96C6\u6210 / \u624B\u6D4B")],
    ["passed", text("Completed / user accepted", "\u5DF2\u5B8C\u6210 / \u7528\u6237\u5DF2\u786E\u8BA4")],
    ["rework", text("Rework required", "\u9700\u8FD4\u5DE5")]
  ].map(
    ([stage, title]) => `<span class="parallel-tag stage-${stage}">${title}</span>`
  ).join(
    ""
  )}</div></header><div id="parallel-viewport" class="parallel-viewport" tabindex="0" aria-label="${text("Task canvas: scroll to zoom, drag to pan, arrow keys to move, +/- zoom, 0 fits.", "\u4EFB\u52A1\u753B\u5E03\uFF1A\u6EDA\u8F6E\u7F29\u653E\uFF0C\u62D6\u52A8\u5E73\u79FB\uFF1B\u65B9\u5411\u952E\u79FB\u52A8\uFF0C\u52A0\u51CF\u952E\u7F29\u653E\uFF0C0 \u663E\u793A\u5168\u90E8\u4EFB\u52A1\u3002")}"><div id="parallel-groups" class="parallel-groups" style="transform:translate(${boardView.x}px,${boardView.y}px) scale(${boardView.scale})">${gs.map(
    ({ key, title, description, invalid, tasks }) => `<section class="parallel-group" data-parallel-group="${esc(key)}" aria-label="${esc(title)}"><header><h2>${esc(title)}</h2>${description ? `<p>${esc(description)}</p>` : ""}</header><div class="parallel-cards">${tasks.map(
      (t) => `<button class="parallel-card stage-${taskStage(t)}" data-parallel-card="${esc(t.id)}" data-cycle="${invalid}" aria-pressed="${selectedTask === t.id}"><span class="parallel-card-top"><b>${esc(t.id)}</b><span class="parallel-effort">${t.priority}</span></span><strong>${esc(t.title)}</strong><span class="parallel-tag stage-${taskStage(t)}">${esc(taskStatusLabel(t))}</span><span class="parallel-owners"><span>${text("Development", "\u5F00\u53D1")} ${esc(t.developer || t.owner || text("Unassigned", "\u672A\u767B\u8BB0"))}</span><span>${text("Review", "\u9A8C\u6536")} ${esc(t.reviewer || text("Unassigned", "\u672A\u767B\u8BB0"))}</span></span>${t.description ? `<span class="parallel-note">${esc(t.description.length > 160 ? t.description.slice(0, 159) + "\u2026" : t.description)}</span>` : ""}${t.blocked ? `<span class="parallel-special">${text("Blocked", "\u963B\u585E")}: ${esc(t.blocked)}</span>` : ""}<span class="parallel-deps">${text("Prerequisites", "\u63A5\u5165\u524D\u7F6E")}: ${esc(t.dependsOn.join(" / ") || text("None", "\u65E0"))}</span>${t.commit ? `<span class="parallel-deps">${text("Commit", "\u63D0\u4EA4")}: ${esc(short(t.commit))}</span>` : ""}</button>`
    ).join("")}</div></section>`
  ).join(
    ""
  )}</div>${!gs.length ? `<div class="map-empty"><h2>${text("Your next task starts here.", "\u4ECE\u4E0B\u4E00\u4E2A\u4EFB\u52A1\u5F00\u59CB\u3002")}</h2><p>${text("Create a task or ask A to break down an Issue. Groups appear from actual dependencies.", "\u65B0\u5EFA\u4EFB\u52A1\uFF0C\u6216\u8BA9 A \u62C6\u5206 Issue\u3002\u4EFB\u52A1\u4F1A\u6309\u5B9E\u9645\u4F9D\u8D56\u5173\u7CFB\u5206\u7EC4\u3002")}</p><button id="board-new-task">\uFF0B ${text("New task", "\u65B0\u5EFA\u4EFB\u52A1")}</button></div>` : ""}</div><footer class="parallel-toolbar"><div class="zoom-controls"><button id="parallel-zoom-out" aria-label="${text("Zoom out tasks", "\u7F29\u5C0F\u4EFB\u52A1\u753B\u5E03")}">\u2212</button><output id="parallel-zoom">${Math.round(boardView.scale * 100)}%</output><button id="parallel-zoom-in" aria-label="${text("Zoom in tasks", "\u653E\u5927\u4EFB\u52A1\u753B\u5E03")}">\uFF0B</button><button id="parallel-fit">${text("Show all tasks", "\u663E\u793A\u5168\u90E8\u4EFB\u52A1")}</button><button id="parallel-actual">100%</button></div><span>${text("Scroll to zoom \xB7 Drag to pan \xB7 Select a card for details", "\u6EDA\u8F6E\u7F29\u653E \xB7 \u62D6\u52A8\u5E73\u79FB \xB7 \u70B9\u51FB\u5361\u7247\u770B\u8BE6\u60C5")}</span></footer></section>`;
}
function renderUpdates() {
  return `<div class="task-list-head"><h2>${text("Current work", "\u672C\u6B21\u66F4\u65B0")}</h2><button id="new-task">\uFF0B ${text("New task", "\u65B0\u5EFA\u4EFB\u52A1")}</button></div>${data.ledger.tasks.length ? data.ledger.tasks.map((t) => `<article class="update-item ${selectedTask === t.id ? "selected-update" : ""}"><button class="update-select" data-update="${esc(t.id)}"><strong>${esc(t.id)} \xB7 ${esc(t.title)}</strong><small>${t.priority} \xB7 ${esc(taskStatusLabel(t))}</small><span>${esc(t.description.length > 180 ? t.description.slice(0, 179) + "\u2026" : t.description)}</span><span class="update-next">${text("Owner", "\u8BA4\u9886")}: ${esc(t.owner || text("Unassigned", "\u672A\u767B\u8BB0"))}${t.commit ? " \xB7 " + short(t.commit) : ""}</span></button><button class="update-detail-button" data-update="${esc(t.id)}">${text("Details", "\u8BE6\u60C5")} \u2192</button></article>`).join("") : `<p class="fine">${text("No tasks recorded yet. A can import confirmed Issues or split a request into independently testable tasks.", "\u6682\u65E0\u4EFB\u52A1\u8BB0\u5F55\u3002A \u53EF\u4EE5\u5BFC\u5165\u5DF2\u786E\u8BA4\u7684 Issue\uFF0C\u6216\u5C06\u9700\u6C42\u62C6\u6210\u53EF\u72EC\u7ACB\u9A8C\u6536\u7684\u4EFB\u52A1\u3002")}</p>`}<details class="learning-section"><summary>${text("Source coverage", "\u6E90\u7801\u8986\u76D6\u60C5\u51B5")}</summary><p class="fine">${snapshot()?.files.length || 0} ${text("files indexed", "\u4E2A\u6587\u4EF6\u5DF2\u7D22\u5F15")} \xB7 ${snapshot()?.modules.length || 0} ${text("modules", "\u4E2A\u6A21\u5757")}</p>${snapshot()?.warnings.map((w) => `<p class="fine">${esc(w)}</p>`).join("") || ""}</details>`;
}
function renderSelectionEmpty() {
  return `<span class="eyebrow">${text("Source-linked explanations", "\u5173\u8054\u6E90\u7801\u7684\u89E3\u91CA")}</span><h2>${text("Select a module or follow a journey", "\u70B9\u6A21\u5757\uFF0C\u6216\u9010\u6B65\u8D70\u4E00\u6B21\u65C5\u7A0B")}</h2><p>${text("Inspect responsibilities, related connections, source evidence, and actual files. Architecture confidence does not replace independent runtime acceptance.", "\u67E5\u770B\u6A21\u5757\u804C\u8D23\u3001\u5173\u8054\u5173\u7CFB\u3001\u6E90\u7801\u8BC1\u636E\u548C\u5B9E\u9645\u6587\u4EF6\u3002\u67B6\u6784\u53EF\u4FE1\u5EA6\u4E0D\u80FD\u4EE3\u66FF\u72EC\u7ACB\u8FD0\u884C\u9A8C\u6536\u3002")}</p>`;
}
function renderResponsibility(m) {
  const manual = m.descriptionOrigin === "manual";
  const origin = manual ? text("Manually edited \xB7 kept on refresh", "\u624B\u52A8\u7F16\u8F91 \xB7 \u66F4\u65B0\u540E\u4FDD\u7559") : m.descriptionOrigin === "source-comment" ? text("From source comments", "\u6E90\u7801\u6CE8\u91CA\u81EA\u52A8\u586B\u5145") : text("Automatically generated", "\u81EA\u52A8\u751F\u6210");
  return `<section class="explain-field responsibility"><div class="responsibility-heading"><h3>${text("What it does", "\u5B83\u8D1F\u8D23\u4EC0\u4E48")}</h3><button id="edit-description">${text("Edit", "\u7F16\u8F91")}</button></div><small class="description-origin">${origin}</small><p class="responsibility-text">${esc(m.description || text("No explanation yet.", "\u5C1A\u65E0\u8BF4\u660E\u3002"))}</p>${manual ? `<details><summary>${text("Latest automatic content", "\u6700\u65B0\u81EA\u52A8\u5185\u5BB9")}</summary><p class="responsibility-text">${esc(m.automaticDescription || text("No automatic explanation yet.", "\u6682\u65E0\u81EA\u52A8\u8BF4\u660E\u3002"))}</p></details>` : ""}${(m.descriptionEvidence || []).map((e) => `<button class="source-link comment-evidence" data-file="${esc(e.path)}"><code>${esc(e.path)}:${e.line}</code><span>${text("Automatic content source", "\u81EA\u52A8\u5185\u5BB9\u6765\u6E90")} \u2197</span></button>`).join("")}</section>`;
}
function renderFeatureSettings(m) {
  if (m.generator !== "java") return "";
  if (m.level === "feature") return `<section class="explain-field feature-settings"><div class="responsibility-heading"><h3>${text("Feature name", "\u529F\u80FD\u540D\u79F0")}</h3><button id="edit-feature-name">${text("Rename", "\u91CD\u547D\u540D")}</button></div><p>${esc(m.name)}</p><small class="description-origin">${m.nameOrigin === "manual" ? text("Manually named \xB7 kept on refresh", "\u624B\u52A8\u547D\u540D \xB7 \u66F4\u65B0\u540E\u4FDD\u7559") : text("Automatically identified", "\u81EA\u52A8\u8BC6\u522B")}${m.automaticName !== void 0 ? `<br>${text("Automatic name", "\u81EA\u52A8\u8BC6\u522B\u540D\u79F0")}: ${esc(m.automaticName)}` : ""}</small></section>`;
  if (m.level !== "class") return "";
  const parent = moduleById(m.parentId || ""), automatic = moduleById(m.automaticParentId || m.parentId || "");
  return `<section class="explain-field feature-settings"><div class="responsibility-heading"><h3>${text("Feature membership", "\u529F\u80FD\u5F52\u5C5E")}</h3><button id="edit-class-feature">${text("Change feature", "\u8C03\u6574\u5F52\u5C5E")}</button></div><p>${esc(parent?.name || text("Unassigned", "\u672A\u5F52\u5C5E"))}</p><small class="description-origin">${m.parentOrigin === "manual" ? text("Manually assigned \xB7 kept on refresh", "\u624B\u52A8\u6307\u5B9A \xB7 \u66F4\u65B0\u540E\u4FDD\u7559") : text("Automatically identified", "\u81EA\u52A8\u8BC6\u522B")}${m.parentOrigin === "manual" ? `<br>${text("Automatic feature", "\u81EA\u52A8\u8BC6\u522B\u5F52\u5C5E")}: ${esc(automatic?.name || text("Unavailable", "\u6682\u65E0"))}` : ""}${m.pendingParentId ? `<br>${text("Saved target is unavailable; showing the automatic feature. Your setting is retained.", "\u624B\u52A8\u76EE\u6807\u529F\u80FD\u5DF2\u4E0D\u5B58\u5728\uFF0C\u6682\u7528\u81EA\u52A8\u5F52\u5C5E\uFF1B\u539F\u8BBE\u7F6E\u4ECD\u4FDD\u7559\u3002")}` : ""}</small></section>`;
}
function renderModuleDetail(m) {
  if (!m) return renderSelectionEmpty();
  return `<span class="eyebrow">${esc(groupTitle(m.kind))} / ${esc(m.level || text("module", "\u5C0F\u6A21\u5757"))}</span><h2>${esc(m.name)}</h2>${m.level === "method" ? `<button id="show-call-chain">${text("Explore call chain", "\u67E5\u770B\u8C03\u7528\u94FE")} \u2192</button>` : ""}${childModules(m.id).length && mapParent !== m.id ? `<button id="enter-module">${text("Open internal architecture", "\u8FDB\u5165\u5185\u90E8\u67B6\u6784")} \u2192</button>` : ""}<span class="status-tag status-${m.confidence === "verified" ? "passed" : m.confidence === "inferred" ? "reference" : "connected"}">${esc(confidence(m.confidence))}</span>${renderFeatureSettings(m)}${m.level === "class" && typeRelations(m).length ? `<section class="explain-field type-relationships"><h3>${text("Code hierarchy", "\u4EE3\u7801\u5C42\u7EA7")}</h3>${typeRelations(m).map((r) => `<button class="source-link" data-symbol-target="${esc(r.target.id)}">${esc(r.label)} \xB7 ${esc(r.target.name)} \u2192</button>`).join("")}</section>` : ""}${renderResponsibility(m)}<section class="explain-field"><h3>${text("What its connections carry", "\u76F8\u5173\u8FDE\u7EBF\u4F20\u7684\u662F\u4EC0\u4E48")}</h3>${snapshot()?.edges.filter((e) => e.from === m.id || e.to === m.id).map(
    (e) => `<button class="connection-item" data-edge="${esc(e.id)}">${esc(moduleById(e.from)?.name || e.from)} \u2192 ${esc(moduleById(e.to)?.name || e.to)}<small>${esc(e.label)} \xB7 ${esc(confidence(e.confidence))}</small></button>${e.generator === "java" ? `<button class="symbol-target" data-symbol-target="${esc(e.from === m.id ? e.to : e.from)}">${text("Go to related declaration", "\u8F6C\u5230\u5173\u8054\u58F0\u660E")} \u2192</button>` : ""}`
  ).join("") || `<p>${text("No relationships recorded.", "\u6682\u65E0\u5DF2\u8BB0\u5F55\u5173\u7CFB\u3002")}</p>`}</section><section class="explain-field"><h3>${text("Source files & navigation", "\u6E90\u6587\u4EF6\u4E0E\u5B9A\u4F4D")}</h3><button id="show-selected-files">${text(`Locate ${m.files.length} related files in the tree`, `\u5728\u6587\u4EF6\u6811\u4E2D\u67E5\u770B ${m.files.length} \u4E2A\u76F8\u5173\u6587\u4EF6`)}</button>${m.evidence.map((e) => `<button class="source-link" data-file="${esc(e.path)}"><code>${esc(e.path)}${e.line ? ":" + e.line : ""}</code><span>${esc(e.note || text("Locate source file", "\u5B9A\u4F4D\u6E90\u6587\u4EF6"))} \u2197</span></button>`).join("")}${!m.evidence.length ? `<p class="fine">${text("No line-level evidence supplied.", "\u5C1A\u672A\u63D0\u4F9B\u884C\u7EA7\u6E90\u7801\u8BC1\u636E\u3002")}</p>` : ""}</section>`;
}
function currentJourney() {
  const list = snapshot()?.journeys || [];
  return list.find((j) => j.id === selectedJourney) || (mapParent ? list.find((j) => j.steps.some((step) => moduleTrail(step.moduleId).some((m) => m.id === mapParent))) : void 0) || list[0];
}
function renderJourneyNav() {
  const j = currentJourney();
  return `<div class="journey-nav"><button id="journey-prev" ${journeyStep <= 0 ? "disabled" : ""}>${text("Previous", "\u4E0A\u4E00\u6B65")}</button><span>${j ? journeyStep < 0 ? text(`${j.steps.length} steps`, `${j.steps.length} \u6B65`) : `${journeyStep + 1} / ${j.steps.length}` : "0"}</span><button id="journey-next" ${!j || journeyStep >= j.steps.length - 1 ? "disabled" : ""}>${text("Next", "\u4E0B\u4E00\u6B65")}</button><button id="journey-all">${text("Entire path", "\u6574\u6761\u8DEF\u5F84")}</button></div>`;
}
function renderJourneys() {
  const list = snapshot()?.journeys || [], j = currentJourney();
  return j ? `<label class="field-label" for="journey-picker">${text("Choose a journey", "\u9009\u62E9\u65C5\u7A0B")}</label><select id="journey-picker">${list.map((journey) => `<option value="${esc(journey.id)}" ${journey.id === j.id ? "selected" : ""}>${esc(journey.name)}</option>`).join("")}</select><p class="fine">${esc(j.description)} \xB7 ${esc(confidence(j.confidence))}</p><details class="steps-disclosure" open><summary>${text("Step list", "\u67E5\u770B\u6B65\u9AA4\u6E05\u5355")}</summary>${j.steps.map((step, i) => `<button class="journey-step" data-step="${i}" aria-pressed="${journeyStep === i}"><span>${i + 1}</span>${esc(step.label)}</button>`).join("")}</details>` : `<h2>${text("Journeys", "\u64CD\u4F5C\u65C5\u7A0B")}</h2><p class="fine">${text("Your Agent can add source-linked user journeys after inspecting the code. No journeys are fabricated from directory names.", "Agent \u9605\u8BFB\u4EE3\u7801\u540E\u53EF\u4EE5\u8865\u5145\u5173\u8054\u6E90\u7801\u7684\u64CD\u4F5C\u65C5\u7A0B\uFF0C\u4E0D\u4F1A\u4EC5\u51ED\u76EE\u5F55\u540D\u79F0\u7F16\u9020\u3002")}</p>`;
}
function renderFiles() {
  const s = snapshot(), root = { children: /* @__PURE__ */ new Map(), path: "", file: false };
  let count = 0;
  for (const f of s?.files || []) {
    if (search && !f.path.toLowerCase().includes(search.toLowerCase()) || relatedOnly && !related.includes(f.path))
      continue;
    count++;
    let node = root;
    const parts = f.path.split("/");
    parts.forEach((part, i) => {
      if (!node.children.has(part))
        node.children.set(part, {
          children: /* @__PURE__ */ new Map(),
          path: parts.slice(0, i + 1).join("/"),
          file: i === parts.length - 1
        });
      node = node.children.get(part);
    });
  }
  const tree = (node) => [...node.children].sort(
    ([, a], [, b]) => Number(a.file) - Number(b.file) || a.path.localeCompare(b.path)
  ).map(
    ([name, n]) => n.file ? `<div class="file-leaf"><button class="file-button ${selectedFile === n.path ? "chosen" : ""} ${related.includes(n.path) ? "related" : ""}" data-tree-file="${esc(n.path)}" title="${esc(n.path)}"><span class="file-dot"></span>${esc(name)}${related.includes(n.path) ? `<small>${text("related", "\u5173\u8054")}</small>` : ""}</button></div>` : `<details data-dir="${esc(n.path)}" ${search || opened.has(n.path) ? "open" : ""}><summary>${esc(name)}</summary><div class="file-branches">${tree(n)}</div></details>`
  ).join("");
  const index = related.indexOf(selectedFile);
  return `<h2>${text("Project file map", "\u9879\u76EE\u6587\u4EF6\u5730\u56FE")}</h2><p class="fine">${text("Source", "\u6765\u6E90")}: ${source === "local" ? text("Local workspace", "\u672C\u5730\u5DE5\u4F5C\u533A") : text("Remote branch", "\u8FDC\u7AEF\u5206\u652F")} \xB7 ${esc(short(s?.source.commit))}</p><label class="field-label" for="file-search" style="margin-top:15px">${text("Find files and paths", "\u67E5\u627E\u6587\u4EF6\u6216\u8DEF\u5F84")}</label><input id="file-search" type="search" placeholder="${text("Search indexed paths\u2026", "\u641C\u7D22\u5DF2\u7D22\u5F15\u8DEF\u5F84\u2026")}" value="${esc(search)}" autocomplete="off"><p class="fine" aria-live="polite">${count} / ${s?.files.length || 0} ${text("files", "\u4E2A\u6587\u4EF6")}</p><div class="file-tools"><button id="files-related" aria-pressed="${relatedOnly}">${text("Related files only", "\u53EA\u770B\u9AD8\u4EAE\u6587\u4EF6")}</button><button id="files-expand">${text("Expand all", "\u5C55\u5F00\u5168\u90E8")}</button><button id="files-collapse">${text("Collapse all", "\u6536\u8D77\u5168\u90E8")}</button></div>${related.length ? `<div class="file-related-nav"><span>${text("Related file", "\u5173\u8054\u6587\u4EF6")} ${index >= 0 ? index + 1 : "\u2014"} / ${related.length}</span><button id="prev-file" ${related.length < 2 ? "disabled" : ""}>\u2191 ${text("Previous", "\u4E0A\u4E00\u4E2A")}</button><button id="next-file" ${related.length < 2 ? "disabled" : ""}>\u2193 ${text("Next", "\u4E0B\u4E00\u4E2A")}</button></div>` : ""}<div id="file-tree" class="file-tree">${tree(root) || `<p class="fine">${text("No matching indexed files.", "\u6CA1\u6709\u5339\u914D\u7684\u5DF2\u7D22\u5F15\u6587\u4EF6\u3002")}</p>`}</div><article id="file-detail">${selectedFile ? `<code>${esc(selectedFile)}</code><p class="fine">${text("Read-only source preview. Local content follows the working tree; remote content follows the cached remote snapshot.", "\u6E90\u7801\u9884\u89C8\u53EA\u8BFB\u3002\u672C\u5730\u5185\u5BB9\u6765\u81EA\u5F53\u524D\u5DE5\u4F5C\u6811\uFF0C\u8FDC\u7AEF\u5185\u5BB9\u6765\u81EA\u72EC\u7ACB\u7F13\u5B58\u5FEB\u7167\u3002")}</p><button class="file-open" id="view-source">${text("Read selected source", "\u8BFB\u53D6\u5F53\u524D\u6E90\u6587\u4EF6")} \u2197</button>` : ""}</article>`;
}
function renderTaskDetail(t) {
  if (!t)
    return `<div class="section-label">${text("A \u2192 B \u2192 C \u2192 you", "A \u2192 B \u2192 C \u2192 \u4F60")}</div><p class="description">${text("A scopes the work. B builds. C reviews independently. After integration, C reviews the integrated version before your handtest.", "A \u62C6\u89E3\u4EFB\u52A1\uFF0CB \u5F00\u53D1\uFF0CC \u72EC\u7ACB\u9A8C\u6536\u3002\u96C6\u6210\u7248\u672C\u518D\u6B21\u901A\u8FC7 C \u9A8C\u6536\u540E\uFF0C\u8FDB\u5165\u4F60\u7684\u624B\u6D4B\u3002")}</p><div class="role-buttons">${["A", "B", "C"].map((role) => `<button data-role="${role}">${text("Copy", "\u590D\u5236")} ${role}</button>`).join("")}</div><div class="section-label">${text("Ledger revision", "\u53F0\u8D26\u7248\u672C")}</div><span class="badge">${data?.ledger.revision}</span><p class="small-print">${text("Task states change through explicit handoff events, never from a chat ending.", "\u4EFB\u52A1\u72B6\u6001\u7531\u660E\u786E\u7684\u4EA4\u63A5\u4E8B\u4EF6\u66F4\u65B0\uFF0C\u4E0D\u901A\u8FC7\u804A\u5929\u7ED3\u675F\u63A8\u65AD\u5B8C\u6210\u3002")}</p>`;
  const review = (r, name) => `<div class="review"><b>${name} \xB7 ${r.passed ? text("Passed", "\u901A\u8FC7") : text("Changes requested", "\u9700\u8FD4\u5DE5")}</b><br>${esc(r.reviewer)} \xB7 ${esc(r.commit)}<br>${esc(r.report)}${r.untested.length ? `<br><span class="pending">${text("Untested", "\u672A\u8986\u76D6")}: ${esc(r.untested.join(", "))}</span>` : ""}<br><span class="muted">${formatDate(r.at)}</span></div>`;
  return `<div class="task-detail-heading"><h2>${esc(t.title)}</h2><button id="edit-task">${text("Edit task", "\u7F16\u8F91\u4EFB\u52A1")}</button></div><span class="badge">${esc(taskStatusLabel(t))}</span> <span class="priority ${t.priority}">${t.priority}</span><p class="description task-multiline">${esc(t.description)}</p><div class="section-label">${text("Acceptance criteria", "\u9A8C\u6536\u6807\u51C6")}</div><ul>${t.criteria.map((c) => `<li>${esc(c)}</li>`).join("")}</ul><dl class="task-detail">${[
    [
      text("Task / issue", "\u4EFB\u52A1 / Issue"),
      t.id + (t.issue ? " \xB7 " + t.issue : "")
    ],
    [
      text(
        "Owner / developer / integrator / reviewer",
        "\u8BA4\u9886 / \u5F00\u53D1 / \u96C6\u6210 / \u9A8C\u6536"
      ),
      [t.owner, t.developer, t.integrator, t.reviewer].filter(Boolean).join(" / ") || "\u2014"
    ],
    [text("Dependencies", "\u4F9D\u8D56"), t.dependsOn.join(", ") || "\u2014"],
    ...t.progress ? [[text("Handoff stage", "\u4EA4\u63A5\u9636\u6BB5"), statusLabel(t.status)]] : [],
    [text("Branch", "\u5206\u652F"), t.branch || "\u2014"],
    [text("Base commit", "\u57FA\u7EBF\u63D0\u4EA4"), t.baseCommit || "\u2014"],
    [text("Development commit", "\u5F00\u53D1\u63D0\u4EA4"), t.commit || "\u2014"],
    [text("Integration commit", "\u96C6\u6210\u63D0\u4EA4"), t.integrationCommit || "\u2014"]
  ].map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join(
    ""
  )}</dl>${t.blocked ? `<p class="description pending">${text("Blocked", "\u963B\u585E")}: ${esc(t.blocked)}</p>` : ""}<div class="section-label">${text("Review evidence", "\u9A8C\u6536\u8BC1\u636E")}</div>${t.acceptanceNotes ? `<div class="review"><b>${text("Manual notes", "\u8865\u5145\u8BB0\u5F55")}</b><p class="task-multiline">${esc(t.acceptanceNotes)}</p></div>` : ""}${t.reviews.map((r, i) => review(r, `${text("C review", "C \u9A8C\u6536")} ${i + 1}`)).join("") || `<p class="description">${text("No independent review yet.", "\u5C1A\u65E0\u72EC\u7ACB\u9A8C\u6536\u8BB0\u5F55\u3002")}</p>`}${t.integrationReview ? review(t.integrationReview, text("Integration review", "\u96C6\u6210\u9A8C\u6536")) : ""}${t.userAcceptance ? `<div class="review"><b>${text("User acceptance", "\u7528\u6237\u786E\u8BA4")}</b><br>${esc(t.userAcceptance.commit)}<br>${esc(t.userAcceptance.source)}<br>${formatDate(t.userAcceptance.at)}</div>` : ""}<div class="role-buttons">${["A", "B", "C"].map((role) => `<button data-role="${role}">${text("Copy", "\u590D\u5236")} ${role}</button>`).join("")}</div><p class="small-print">${text("Every review must name its exact commit. Only the user can confirm handtest acceptance.", "\u9A8C\u6536\u5FC5\u987B\u7ED1\u5B9A\u5B9E\u9645\u63D0\u4EA4\u3002\u53EA\u6709\u7528\u6237\u80FD\u786E\u8BA4\u624B\u6D4B\u901A\u8FC7\u3002")}</p>`;
}
function locateFile(path, files) {
  if (!snapshot()?.files.some((file) => file.path === path)) {
    toast(text("This file is not in the selected source index.", "\u6B64\u6587\u4EF6\u672A\u5305\u542B\u5728\u5F53\u524D\u6765\u6E90\u7684\u7D22\u5F15\u4E2D\u3002"));
    return;
  }
  selectedFile = path;
  related = files?.length ? files : related.includes(path) ? related : [path];
  viewMode = "map";
  tab = "folders";
  search = "";
  relatedOnly = false;
  const parts = path.split("/");
  for (let i = 1; i < parts.length; i++)
    opened.add(parts.slice(0, i).join("/"));
  render();
  requestAnimationFrame(() => {
    if (viewMode !== "map" || tab !== "folders" || selectedFile !== path || search) return;
    const leaf = [
      ...document.querySelectorAll("[data-tree-file]")
    ].find((el) => el.dataset.treeFile === path);
    if (leaf) {
      leaf.scrollIntoView({ block: "center", behavior: "auto" });
      leaf.focus({ preventScroll: true });
    }
  });
}
function stepFile(delta) {
  if (!related.length) return;
  const index = (related.indexOf(selectedFile) + delta + related.length) % related.length;
  locateFile(related[index], related);
}
function selectModule(id, fromJourney = false) {
  selectedModule = id;
  selectedTask = "";
  if (tab === "folders") tab = "updates";
  const m = moduleById(id);
  if (m) collapsed.delete(m.kind || "source");
  if (!fromJourney) journeyStep = -1;
  const viewport = document.getElementById("viewport");
  view.x -= viewport?.scrollLeft || 0;
  view.y -= viewport?.scrollTop || 0;
  render();
  requestAnimationFrame(
    () => document.querySelector("#selection")?.scrollIntoView({ block: "start", behavior: "smooth" })
  );
}
function selectTask(id) {
  selectedTask = id;
  selectedModule = "";
  const task = data?.ledger.tasks.find((t) => t.id === id);
  if (task) {
    for (const g of groups())
      if (g.modules.some((m) => m.files.some((p) => task.files.includes(p))))
        collapsed.delete(g.id);
  }
  render();
  if (viewMode === "map")
    requestAnimationFrame(
      () => document.querySelector("#selection")?.scrollIntoView({ block: "start", behavior: "smooth" })
    );
}
function showJourney(index) {
  const j = currentJourney();
  if (!j) return;
  selectedJourney = j.id;
  const nextStep = j.steps[index];
  const trails = j.steps.map((step) => moduleTrail(step.moduleId).slice(0, -1));
  const common = trails[0]?.filter((m) => trails.every((trail) => trail.some((n) => n.id === m.id))).at(-1)?.id || "";
  const parent = nextStep ? moduleById(nextStep.moduleId)?.parentId || "" : common;
  navigateMap(parent, "", false);
  tab = "journeys";
  journeyStep = Math.max(-1, Math.min(j.steps.length - 1, index));
  selectedTask = "";
  selectedModule = journeyStep >= 0 ? j.steps[journeyStep].moduleId : "";
  for (const step of j.steps) {
    const m = moduleById(step.moduleId);
    if (m) {
      if (!m.parentId && indexedDirectoryCount() && isIndexedDirectory(m)) showIndexedDirectories = true;
      collapsed.delete(m.kind || "source");
    }
  }
  initialFit = true;
  render();
  if (selectedModule) focusModule(selectedModule);
  else fitGraph();
}
function bind() {
  const on = (id, fn) => document.getElementById(id)?.addEventListener("click", fn);
  on("map-up", () => navigateMap(callRoot ? mapParent : moduleById(mapParent)?.parentId || ""));
  on("show-call-chain", () => navigateMap(mapParent, selectedModule));
  on("indexed-directories", () => {
    showIndexedDirectories = !showIndexedDirectories;
    if (showIndexedDirectories) collapsed.delete("directory");
    render();
    fitGraph();
    document.getElementById("indexed-directories")?.focus();
  });
  document.querySelectorAll("[data-symbol-target]").forEach(
    (el) => el.addEventListener("click", () => {
      const id = el.dataset.symbolTarget, m = moduleById(id);
      if (!m) return;
      navigateMap(m.parentId || "");
      selectedModule = id;
      render();
      focusModule(id);
    })
  );
  on("enter-module", () => navigateMap(selectedModule));
  on("edit-description", openDescriptionEditor);
  on("edit-feature-name", () => openArchitectureEditor("name"));
  on("edit-class-feature", () => openArchitectureEditor("parentId"));
  document.querySelectorAll("[data-map-scope]").forEach(
    (el) => el.addEventListener("click", () => navigateMap(el.dataset.mapScope))
  );
  document.querySelector("#module-search")?.addEventListener("input", (e) => {
    mapQuery = e.target.value;
    render();
    if (mapQuery) fitGraph();
  });
  on("language-button", () => {
    lang = lang === "zh" ? "en" : "zh";
    localStorage.setItem("nativue-language", lang);
    render();
  });
  on("settings-button", openSettings);
  on("help-button", openHelp);
  on("role-button", () => openRoles());
  on("empty-role", () => openRoles());
  on("refresh-button", () => void control("scan"));
  on("analysis-button", () => void control("analyze"));
  on("notice-analyze", () => void control("analyze"));
  on("sync-button", () => void control("remote"));
  on(
    "pause-button",
    () => void control(data?.runtime.paused ? "resume" : "pause")
  );
  on("new-task", () => openTask());
  on("board-new-task", () => openTask());
  on(
    "edit-task",
    () => openTask(data?.ledger.tasks.find((t) => t.id === selectedTask))
  );
  on("show-selected-files", () => {
    const m = moduleById(selectedModule);
    if (m?.files.length) locateFile(m.files[0], m.files);
  });
  on("prev-file", () => stepFile(-1));
  on("next-file", () => stepFile(1));
  on("view-source", () => void showSource(selectedFile));
  on("files-related", () => {
    relatedOnly = !relatedOnly;
    render();
  });
  on("files-expand", () => {
    for (const f of snapshot()?.files || []) {
      const parts = f.path.split("/");
      for (let i = 1; i < parts.length; i++)
        opened.add(parts.slice(0, i).join("/"));
    }
    render();
  });
  on("files-collapse", () => {
    opened.clear();
    render();
  });
  on("dev-board-open", () => {
    viewMode = "parallel";
    render();
  });
  document.querySelector("#parallel-grouping")?.addEventListener("change", (e) => {
    parallelGrouping = e.target.value === "dependency" ? "dependency" : "module";
    render();
    fitBoard();
    document.getElementById("parallel-grouping")?.focus();
  });
  on("dev-map-open", () => {
    viewMode = "map";
    render();
  });
  on("journey-prev", () => showJourney(journeyStep - 1));
  on("journey-next", () => showJourney(journeyStep + 1));
  on("journey-all", () => showJourney(-1));
  on("fit", fitGraph);
  on("focus", () => focusModule(selectedModule));
  on("clear", () => {
    selectedModule = "";
    selectedTask = "";
    journeyStep = -1;
    selectedFile = "";
    related = [];
    render();
  });
  on("arrange-code", () => {
    mapQuery = "";
    nodePositions.clear();
    groupPositions.clear();
    collapsed.clear();
    render();
    fitGraph();
  });
  on("reset-layout", () => {
    nodePositions.clear();
    groupPositions.clear();
    collapsed.clear();
    render();
    fitGraph();
  });
  on("zoom-in", () => zoom(1.2));
  on("zoom-out", () => zoom(1 / 1.2));
  on("parallel-zoom-in", () => zoom(1.2, void 0, void 0, true));
  on("parallel-zoom-out", () => zoom(1 / 1.2, void 0, void 0, true));
  on("parallel-fit", fitBoard);
  on("parallel-actual", () => {
    boardView = { x: 20, y: 20, scale: 1 };
    paintView(true);
  });
  document.querySelectorAll("[data-tab]").forEach((el) => {
    el.addEventListener("click", () => {
      tab = el.dataset.tab;
      render();
    });
    el.addEventListener("keydown", (e) => {
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        const tabs = ["updates", "journeys", "folders"];
        tab = tabs[(tabs.indexOf(tab) + (e.key === "ArrowRight" ? 1 : 2)) % 3];
        render();
        document.getElementById("tab-" + tab)?.focus();
      }
    });
  });
  document.querySelector("#version-picker")?.addEventListener("change", (e) => {
    if (layoutSaveTimer !== void 0) rememberMap();
    source = e.target.value;
    mapParent = "";
    callRoot = "";
    layoutKey = "";
    mapLocations.clear();
    showIndexedDirectories = false;
    selectedModule = "";
    selectedFile = "";
    selectedJourney = "";
    related = [];
    nodePositions.clear();
    groupPositions.clear();
    initialFit = false;
    view = { x: 0, y: 0, scale: 1 };
    restoreMap();
    render();
  });
  document.querySelector("#journey-picker")?.addEventListener("change", (e) => {
    selectedJourney = e.target.value;
    showJourney(-1);
  });
  document.querySelectorAll("[data-step]").forEach(
    (el) => el.addEventListener("click", () => showJourney(Number(el.dataset.step)))
  );
  document.querySelectorAll("[data-parallel-card]").forEach(
    (el) => el.addEventListener("click", () => selectTask(el.dataset.parallelCard))
  );
  document.querySelectorAll("[data-update]").forEach(
    (el) => el.addEventListener("click", () => selectTask(el.dataset.update))
  );
  document.querySelectorAll("[data-file]").forEach(
    (el) => el.addEventListener("click", () => {
      const m = moduleById(selectedModule), t = data?.ledger.tasks.find((t2) => t2.id === selectedTask);
      locateFile(el.dataset.file, selectedTask ? t?.files : m?.files);
    })
  );
  document.querySelectorAll("[data-tree-file]").forEach(
    (el) => el.addEventListener("click", () => {
      selectedFile = el.dataset.treeFile;
      render();
    })
  );
  document.querySelectorAll("[data-dir]").forEach(
    (el) => el.addEventListener("toggle", () => {
      el.open ? opened.add(el.dataset.dir) : opened.delete(el.dataset.dir);
    })
  );
  document.querySelector("#file-search")?.addEventListener("input", (e) => {
    search = e.target.value;
    render();
  });
  document.querySelectorAll("[data-role]").forEach(
    (el) => el.addEventListener("click", () => void copyRole(el.dataset.role))
  );
  document.querySelectorAll("[data-group]").forEach(
    (el) => el.addEventListener("click", () => {
      const id = el.dataset.group;
      collapsed.has(id) ? collapsed.delete(id) : collapsed.add(id);
      render();
    })
  );
  document.querySelectorAll("[data-edge]").forEach(
    (el) => el.addEventListener("click", () => {
      const edge = snapshot()?.edges.find((e) => e.id === el.dataset.edge);
      if (edge?.evidence.length)
        locateFile(
          edge.evidence[0].path,
          edge.evidence.map((e) => e.path)
        );
    })
  );
}
function fitView(width, height, bounds, max = 1.1) {
  const scale = Math.max(
    0.04,
    Math.min(
      max,
      Math.max(1, width - 48) / bounds.width,
      Math.max(1, height - 48) / bounds.height
    )
  );
  return {
    scale,
    x: (width - bounds.width * scale) / 2 - bounds.x * scale,
    y: (height - bounds.height * scale) / 2 - bounds.y * scale
  };
}
function zoom(factor, x, y, board = false, wheel = false) {
  const current = board ? boardView : view;
  const vp = document.getElementById(board ? "parallel-viewport" : "viewport");
  if (!vp) return;
  x = x ?? vp.clientWidth / 2;
  y = y ?? vp.clientHeight / 2;
  const scale = Math.max(
    board ? 0.02 : 0.1,
    Math.min(1.8, current.scale * factor)
  );
  const k = scale / current.scale;
  const next = {
    scale,
    x: x - (x - current.x) * k,
    y: y - (y - current.y) * k
  };
  if (board) boardView = next;
  else view = next;
  paintView(board, !wheel);
  if (!board && wheel) {
    clearTimeout(layoutSaveTimer);
    layoutSaveTimer = setTimeout(rememberMap, 150);
  }
}
function paintView(board = false, persist = true) {
  if (!board && persist) rememberMap();
  const v = board ? boardView : view, world = document.getElementById(board ? "parallel-groups" : "world"), vp = document.getElementById(board ? "parallel-viewport" : "viewport");
  if (world)
    world.style.transform = `translate(${v.x}px,${v.y}px) scale(${v.scale})`;
  if (vp) {
    vp.style.backgroundSize = `${22 * v.scale}px ${22 * v.scale}px`;
    vp.style.backgroundPosition = `${v.x}px ${v.y}px`;
  }
  const output = document.getElementById(board ? "parallel-zoom" : "zoom");
  if (output) output.textContent = Math.round(v.scale * 100) + "%";
}
function fitGraph() {
  const vp = document.getElementById("viewport"), gs = groups();
  if (!vp || !gs.length) return;
  const bounds = boundsOf(
    [
      ...gs,
      ...gs.flatMap(
        (g) => collapsed.has(g.id) ? [] : g.modules.map((m) => ({
          ...nodePos(m, g),
          width: 316,
          height: g.hierarchy ? 154 : 124
        }))
      )
    ],
    30
  );
  view = fitView(vp.clientWidth, vp.clientHeight, bounds);
  paintView();
}
function fitBoard() {
  const vp = document.getElementById("parallel-viewport"), world = document.getElementById("parallel-groups");
  if (!vp || !world || !data?.ledger.tasks.length) return;
  boardView = fitView(
    vp.clientWidth,
    vp.clientHeight,
    { x: 0, y: 0, width: world.offsetWidth, height: world.offsetHeight },
    1
  );
  paintView(true);
}
function focusModule(id) {
  const target = moduleById(id);
  if (target && target.id !== mapParent && !callRoot)
    navigateMap(target.parentId || "");
  const m = moduleById(id), vp = document.getElementById("viewport");
  if (!m || !vp) return;
  if (id === mapParent) {
    fitGraph();
    return;
  }
  const revealDirectory = !showIndexedDirectories && indexedDirectoryCount() && isIndexedDirectory(m);
  if (revealDirectory) showIndexedDirectories = true;
  const expanded = collapsed.delete(m.kind || "source");
  const p = nodePos(m);
  view = fitView(
    vp.clientWidth,
    vp.clientHeight,
    { ...p, width: 316, height: 124 },
    1
  );
  if (expanded || revealDirectory) render();
  paintView();
}
function moveGroup(id, dx, dy) {
  const g = groups().find((g2) => g2.id === id);
  if (!g) return;
  for (const m of g.modules) {
    const p = nodePos(m, g);
    nodePositions.set(m.id, { x: p.x + dx, y: p.y + dy });
  }
  groupPositions.set(id, { x: g.x + dx, y: g.y + dy, columns: g.columns });
}
var lastNodeClick = null;
function bindCanvas(board = false) {
  const vp = document.getElementById(board ? "parallel-viewport" : "viewport");
  if (!vp) return;
  stageSize = { width: vp.clientWidth, height: vp.clientHeight };
  let drag = null, frame = 0;
  const drawDrag = () => {
    frame = 0;
    const d = drag;
    if (!d?.moved) return;
    const dx = d.x - d.startX, dy = d.y - d.startY;
    if (d.type === "pan") {
      const current = board ? boardView : view;
      current.x = d.origin.x + dx;
      current.y = d.origin.y + dy;
      paintView(board, false);
    } else {
      const mx = dx / d.origin.scale, my = dy / d.origin.scale;
      if (d.element) d.element.style.transform = `translate(${mx}px,${my}px)`;
      const position = (id) => {
        const p = d.points.get(id);
        return d.affected.has(id) ? { x: p.x + mx, y: p.y + my } : p;
      };
      for (const p of d.paths) p.element.setAttribute("d", p.type ? typeLinkPath(position(p.from), position(p.to)) : edgePath(position(p.from), position(p.to), p.index));
    }
  };
  const finishDrag = (cancelled = false, ev) => {
    const d = drag;
    if (!d) return;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    if (ev && !cancelled) {
      d.x = ev.clientX;
      d.y = ev.clientY;
    }
    if (cancelled) {
      if (board) boardView = { ...d.origin };
      else view = { ...d.origin };
    } else if (d.moved) {
      drawDrag();
      if (d.type !== "pan") {
        const dx = (d.x - d.startX) / d.origin.scale, dy = (d.y - d.startY) / d.origin.scale;
        for (const { group: g, positions } of d.layout) {
          groupPositions.set(g.id, { x: g.x, y: g.y, columns: g.columns });
          for (const [id, p] of positions) nodePositions.set(
            id,
            d.affected.has(id) ? { x: p.x + dx, y: p.y + dy } : p
          );
        }
        if (d.type === "group") {
          const g = d.layout.find((l) => l.group.id === d.id).group;
          groupPositions.set(d.id, { x: g.x + dx, y: g.y + dy, columns: g.columns });
        }
      }
    }
    drag = null;
    canvasGestureActive = false;
    vp.classList.remove("is-dragging", "is-dragging-node");
    window.removeEventListener("blur", cancelDrag);
    if (vp.hasPointerCapture(d.pointerId)) vp.releasePointerCapture(d.pointerId);
    const pending = canvasRenderPending;
    canvasRenderPending = false;
    if (!cancelled && d.type === "node" && !d.moved && ev) {
      const scope = source + ":" + scopeKey();
      const doubleClick = lastNodeClick?.id === d.id && lastNodeClick.scope === scope && ev.timeStamp - lastNodeClick.at <= 500 && Math.hypot(ev.clientX - lastNodeClick.x, ev.clientY - lastNodeClick.y) <= 8;
      lastNodeClick = doubleClick ? null : { id: d.id, scope, at: ev.timeStamp, x: ev.clientX, y: ev.clientY };
      if (doubleClick && childModules(d.id).length) navigateMap(d.id);
      selectModule(d.id);
    } else {
      lastNodeClick = null;
      if (cancelled || d.type !== "pan" || pending) render();
      else paintView(board);
    }
    if (pending) void refresh();
  };
  const cancelDrag = () => finishDrag(true);
  vp.addEventListener("pointerdown", (ev) => {
    if (drag || ev.button !== 0 || !ev.isPrimary || ev.target.closest("[data-group],.map-empty")) return;
    const node = ev.target.closest("[data-node]"), group = ev.target.closest("[data-drag-group]");
    if (board && ev.target.closest("button")) return;
    if (!board && layoutSaveTimer !== void 0) rememberMap();
    if (!node) lastNodeClick = null;
    const current = board ? boardView : view;
    current.x -= vp.scrollLeft;
    current.y -= vp.scrollTop;
    vp.scrollLeft = 0;
    vp.scrollTop = 0;
    paintView(board, false);
    const layout = node || group ? groups().map((g) => ({
      group: g,
      positions: new Map(g.modules.map((m) => [m.id, { ...nodePos(m, g) }]))
    })) : [];
    const points = new Map(layout.flatMap((l) => [...l.positions]));
    const affected = new Set(node ? [node.dataset.node] : layout.find((l) => l.group.id === group?.dataset.dragGroup)?.group.modules.map((m) => m.id) || []);
    const paths = affected.size ? [...vp.querySelectorAll("path.edge,path.containment")].map((element) => ({
      element,
      from: element.dataset.from || element.dataset.owner || "",
      to: element.dataset.to || element.dataset.member || "",
      type: element.classList.contains("containment") || element.dataset.route === "type",
      index: Number(element.dataset.routeIndex || 0)
    })).filter((p) => points.has(p.from) && points.has(p.to) && (affected.has(p.from) || affected.has(p.to))) : [];
    drag = {
      type: node ? "node" : group ? "group" : "pan",
      id: node?.dataset.node || group?.dataset.dragGroup || "",
      pointerId: ev.pointerId,
      startX: ev.clientX,
      startY: ev.clientY,
      x: ev.clientX,
      y: ev.clientY,
      origin: { ...current },
      moved: false,
      layout,
      points,
      affected,
      element: node || group?.closest("[data-group-box]") || null,
      paths
    };
    canvasGestureActive = true;
    window.addEventListener("blur", cancelDrag);
    vp.focus({ preventScroll: true });
    vp.setPointerCapture(ev.pointerId);
    ev.preventDefault();
  });
  vp.addEventListener("pointermove", (ev) => {
    if (!drag || drag.pointerId !== ev.pointerId) return;
    drag.x = ev.clientX;
    drag.y = ev.clientY;
    if (!drag.moved && Math.hypot(drag.x - drag.startX, drag.y - drag.startY) <= 4) return;
    drag.moved = true;
    lastNodeClick = null;
    vp.classList.add("is-dragging");
    if (drag.type === "node") vp.classList.add("is-dragging-node");
    if (!frame) frame = requestAnimationFrame(drawDrag);
  });
  vp.addEventListener("pointerup", (ev) => {
    if (drag?.pointerId === ev.pointerId) finishDrag(false, ev);
  });
  vp.addEventListener("pointercancel", cancelDrag);
  vp.addEventListener("lostpointercapture", cancelDrag);
  vp.addEventListener(
    "wheel",
    (ev) => {
      ev.preventDefault();
      if (drag) return;
      const rect = vp.getBoundingClientRect(), delta = ev.deltaY * (ev.deltaMode === 1 ? 16 : ev.deltaMode === 2 ? vp.clientHeight : 1);
      zoom(
        Math.exp(-Math.max(-100, Math.min(100, delta)) * 25e-4),
        ev.clientX - rect.left,
        ev.clientY - rect.top,
        board,
        true
      );
    },
    { passive: false }
  );
  vp.addEventListener("keydown", (ev) => {
    if (drag) {
      ev.preventDefault();
      if (ev.key === "Escape") cancelDrag();
      return;
    }
    if (ev.altKey && !board) {
      const node = ev.target.closest("[data-node]"), group = ev.target.closest(
        "[data-drag-group]"
      );
      if ((node || group) && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(ev.key)) {
        ev.preventDefault();
        const dx = ev.key === "ArrowLeft" ? -15 : ev.key === "ArrowRight" ? 15 : 0, dy = ev.key === "ArrowUp" ? -15 : ev.key === "ArrowDown" ? 15 : 0;
        if (group) moveGroup(group.dataset.dragGroup, dx, dy);
        else if (node) {
          const m = moduleById(node.dataset.node);
          if (m) {
            const p = nodePos(m);
            nodePositions.set(m.id, { x: p.x + dx, y: p.y + dy });
          }
        }
        const id = node?.dataset.node, groupId = group?.dataset.dragGroup;
        render();
        [
          ...document.querySelectorAll(
            id ? "[data-node]" : "[data-drag-group]"
          )
        ].find(
          (el) => id ? el.dataset.node === id : el.dataset.dragGroup === groupId
        )?.focus();
        return;
      }
    }
    if (ev.target.closest("button") && ev.target !== vp) return;
    const current = board ? boardView : view;
    switch (ev.key) {
      case "ArrowLeft":
        current.x += 35;
        break;
      case "ArrowRight":
        current.x -= 35;
        break;
      case "ArrowUp":
        current.y += 35;
        break;
      case "ArrowDown":
        current.y -= 35;
        break;
      case "+":
      case "=":
        zoom(1.2, void 0, void 0, board);
        break;
      case "-":
        zoom(1 / 1.2, void 0, void 0, board);
        break;
      case "0":
        board ? fitBoard() : fitGraph();
        break;
      default:
        return;
    }
    ev.preventDefault();
    paintView(board);
  });
  if (!board) {
    document.querySelectorAll("[data-node]").forEach(
      (el) => el.addEventListener("click", (e) => {
        if (e.detail === 0) {
          lastNodeClick = null;
          selectModule(el.dataset.node);
        }
      })
    );
  }
  paintView(board);
}
function bindResize() {
  const handle = document.getElementById("resize-handle");
  if (!handle) return;
  let drag = false;
  const resize = (width) => {
    sideWidth = Math.max(320, Math.min(720, window.innerWidth - 300, width));
    document.querySelector(".workspace")?.style.setProperty("--side-width", sideWidth + "px");
    handle.setAttribute("aria-valuenow", String(sideWidth));
    localStorage.setItem("nativue-side-width", String(sideWidth));
  };
  handle.addEventListener("pointerdown", (e) => {
    drag = true;
    handle.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  handle.addEventListener("pointermove", (e) => {
    if (drag) resize(window.innerWidth - e.clientX);
  });
  handle.addEventListener("pointerup", (e) => {
    drag = false;
    if (handle.hasPointerCapture(e.pointerId))
      handle.releasePointerCapture(e.pointerId);
  });
  handle.addEventListener("pointercancel", () => {
    drag = false;
  });
  handle.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      resize(sideWidth + (e.key === "ArrowLeft" ? 20 : -20));
    }
  });
}
function openModal(title, body, wide = false) {
  modalCleanup?.();
  document.querySelector(".modal-backdrop")?.remove();
  modal = title;
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `<section class="modal ${wide ? "code-modal" : ""}" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="modal-head"><h2>${esc(title)}</h2><button class="subtle" id="close-modal" aria-label="${text("Close", "\u5173\u95ED")}">\xD7</button></div>${body}</section>`;
  document.body.append(backdrop);
  const close = () => {
    backdrop.remove();
    modal = "";
    modalCleanup?.();
    modalCleanup = void 0;
  };
  backdrop.querySelector("#close-modal").addEventListener("click", close);
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) close();
  });
  const key = (e) => {
    if (e.key === "Escape") {
      close();
      document.removeEventListener("keydown", key);
    }
    if (e.key === "Tab") {
      const focusable = [
        ...backdrop.querySelectorAll(
          "button,input,select,textarea,a[href]"
        )
      ].filter((el) => !el.hasAttribute("disabled"));
      const first = focusable[0], last = focusable.at(-1);
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    }
  };
  document.addEventListener("keydown", key);
  modalCleanup = () => document.removeEventListener("keydown", key);
  requestAnimationFrame(
    () => backdrop.querySelector("input,select,button")?.focus()
  );
  return backdrop;
}
function closeModal() {
  modalCleanup?.();
  modalCleanup = void 0;
  document.querySelector(".modal-backdrop")?.remove();
  modal = "";
}
function openArchitectureEditor(field) {
  const m = moduleById(selectedModule);
  if (!m || !data) return;
  const revision = data.architectureRevision || 0, editSource = source;
  const naming = field === "name";
  const autoParent = moduleById(m.automaticParentId || m.parentId || "");
  const choices = snapshot().modules.filter((n) => n.generator === "java" && n.level === "feature" && n.parentId === autoParent?.parentId);
  const isManual = naming ? m.nameOrigin === "manual" : m.parentOrigin === "manual" || !!m.pendingParentId;
  const automatic = naming ? m.automaticName ?? m.name : autoParent?.name || text("Unavailable", "\u6682\u65E0\u81EA\u52A8\u5F52\u5C5E");
  const shell = openModal(
    naming ? text("Rename feature", "\u4FEE\u6539\u529F\u80FD\u540D\u79F0") : text("Change class feature", "\u8C03\u6574\u7C7B\u7684\u529F\u80FD\u5F52\u5C5E"),
    `<form id="architecture-form"><p>${esc(m.symbol || m.name)}</p><p class="fine">${text("Your setting survives analysis refreshes. You can restore the latest automatic result independently.", "\u624B\u52A8\u8BBE\u7F6E\u5728\u91CD\u65B0\u5206\u6790\u540E\u4FDD\u7559\uFF0C\u53EF\u4EE5\u5355\u72EC\u6062\u590D\u5230\u6700\u65B0\u81EA\u52A8\u7ED3\u679C\u3002")}</p><div class="form-row"><label for="architecture-value">${naming ? text("Feature name", "\u529F\u80FD\u540D\u79F0") : text("Target feature", "\u76EE\u6807\u529F\u80FD")}</label>${naming ? `<input id="architecture-value" name="value" required maxlength="100" value="${esc(m.name)}">` : `<select id="architecture-value" name="value">${choices.map((n) => `<option value="${esc(n.id)}" ${n.id === m.parentId ? "selected" : ""}>${esc(n.name)}</option>`).join("")}</select>`}</div><p class="fine">${text("Latest automatic result", "\u6700\u65B0\u81EA\u52A8\u8BC6\u522B\u7ED3\u679C")}: ${esc(automatic)}</p><p id="architecture-error" role="alert" class="description danger"></p><div class="form-actions"><button type="button" id="cancel-architecture">${text("Cancel", "\u53D6\u6D88")}</button>${isManual ? `<button type="button" id="reset-architecture">${text("Restore automatic result", "\u6062\u590D\u81EA\u52A8\u8BC6\u522B")}</button>` : ""}<button class="primary" type="submit">${text("Save", "\u4FDD\u5B58")}</button></div></form>`
  );
  let saving = false;
  const submit = async (value) => {
    if (saving) return;
    saving = true;
    shell.querySelectorAll(".form-actions button").forEach((b) => b.disabled = true);
    try {
      await api("/api/architecture-edits", { source: editSource, moduleId: m.id, field, value, revision });
      closeModal();
      await refresh();
      if (!naming && source === editSource) {
        const updated = moduleById(m.id);
        if (updated) {
          navigateMap(updated.parentId || "");
          selectedModule = updated.id;
          render();
          focusModule(updated.id);
        }
      }
      toast(value === null ? text("Automatic result restored.", "\u5DF2\u6062\u590D\u81EA\u52A8\u8BC6\u522B\u7ED3\u679C\u3002") : text("Feature setting saved.", "\u529F\u80FD\u8BBE\u7F6E\u5DF2\u4FDD\u5B58\u3002"));
    } catch (e) {
      shell.querySelector("#architecture-error").textContent = String(e);
    } finally {
      saving = false;
      shell.querySelectorAll(".form-actions button").forEach((b) => b.disabled = false);
    }
  };
  shell.querySelector("#architecture-form").addEventListener("submit", (e) => {
    e.preventDefault();
    void submit(shell.querySelector("#architecture-value").value);
  });
  shell.querySelector("#cancel-architecture").addEventListener("click", closeModal);
  shell.querySelector("#reset-architecture")?.addEventListener("click", () => void submit(null));
}
function openDescriptionEditor() {
  const m = moduleById(selectedModule);
  if (!m || !data) return;
  const revision = data.descriptionRevision || 0, editSource = source;
  const automatic = m.automaticDescription ?? m.description;
  const shell = openModal(
    text("Edit responsibility", "\u7F16\u8F91\u804C\u8D23\u8BF4\u660E"),
    `<form id="description-form"><p>${esc(m.name)}</p><p class="fine">${text("Your edit is kept when source analysis refreshes. Restore automatic content to use the latest source explanation.", "\u624B\u52A8\u4FEE\u6539\u5728\u91CD\u65B0\u5206\u6790\u540E\u4FDD\u7559\u3002\u6062\u590D\u81EA\u52A8\u5185\u5BB9\u540E\uFF0C\u5C06\u4F7F\u7528\u6700\u65B0\u7684\u6E90\u7801\u8BF4\u660E\u3002")}</p><div class="form-row"><label for="description-text">${text("What it does", "\u5B83\u8D1F\u8D23\u4EC0\u4E48")}</label><textarea id="description-text" name="description" maxlength="12000" rows="8">${esc(m.description)}</textarea></div><details><summary>${text("Latest automatic content", "\u6700\u65B0\u81EA\u52A8\u5185\u5BB9")}</summary><p class="responsibility-text">${esc(automatic)}</p></details><p id="description-error" role="alert" class="description danger"></p><div class="form-actions"><button type="button" id="cancel-description">${text("Cancel", "\u53D6\u6D88")}</button>${m.descriptionOrigin === "manual" ? `<button type="button" id="reset-description">${text("Restore automatic content", "\u6062\u590D\u81EA\u52A8\u5185\u5BB9")}</button>` : ""}<button class="primary" type="submit">${text("Save", "\u4FDD\u5B58")}</button></div></form>`
  );
  let saving = false;
  const submit = async (description) => {
    if (saving) return;
    saving = true;
    shell.querySelectorAll(".form-actions button").forEach((b) => b.disabled = true);
    try {
      await api("/api/descriptions", { source: editSource, moduleId: m.id, revision, description });
      closeModal();
      await refresh();
      toast(description === null ? text("Automatic content restored.", "\u5DF2\u6062\u590D\u81EA\u52A8\u5185\u5BB9\u3002") : text("Responsibility saved.", "\u804C\u8D23\u8BF4\u660E\u5DF2\u4FDD\u5B58\u3002"));
    } catch (e) {
      shell.querySelector("#description-error").textContent = String(e);
    } finally {
      saving = false;
      shell.querySelectorAll(".form-actions button").forEach((b) => b.disabled = false);
    }
  };
  shell.querySelector("#description-form").addEventListener("submit", (e) => {
    e.preventDefault();
    void submit(shell.querySelector("#description-text").value);
  });
  shell.querySelector("#cancel-description").addEventListener("click", closeModal);
  shell.querySelector("#reset-description")?.addEventListener("click", () => void submit(null));
}
function openSettings() {
  if (!data) return;
  const c = data.config;
  const shell = openModal(
    text("Make it your workspace.", "\u4E3A\u4F60\u7684\u5DE5\u4F5C\u533A\u914D\u7F6E\u3002"),
    `<p>${text("Choose how your AI tools work together. Source data stays in your local workspace.", "\u9009\u62E9 AI \u5DE5\u5177\u7684\u534F\u4F5C\u65B9\u5F0F\u3002\u6570\u636E\u4FDD\u5B58\u5728\u4F60\u7684\u672C\u5730\u5DE5\u4F5C\u533A\u3002")}</p><form id="settings-form"><div class="form-grid"><div><label for="tool">${text("AI tool", "AI \u5DE5\u5177")}</label><select id="tool" name="tool"><option value="codex" ${c.tool === "codex" ? "selected" : ""}>Codex</option><option value="claude" ${c.tool === "claude" ? "selected" : ""}>Claude Code</option><option value="workbuddy" ${c.tool === "workbuddy" ? "selected" : ""}>WorkBuddy</option></select></div><div><label for="mode">${text("Collaboration mode", "\u534F\u4F5C\u6A21\u5F0F")}</label><select id="mode" name="mode"><option value="manual" ${c.mode === "manual" ? "selected" : ""}>${text("Independent A / B / C conversations", "\u72EC\u7ACB A / B / C \u5BF9\u8BDD")}</option><option value="automatic" ${c.mode === "automatic" ? "selected" : ""}>${text("A + sub-agents (when supported)", "A + \u5B50 Agent\uFF08\u5DE5\u5177\u652F\u6301\u65F6\uFF09")}</option></select></div></div><div class="form-row"><label>${text("Role models \xB7 optional, chosen in your AI tool", "\u89D2\u8272\u6A21\u578B \xB7 \u53EF\u9009\uFF0C\u5728 AI \u5DE5\u5177\u4E2D\u9009\u62E9")}</label><div class="models">${["A", "B", "C"].map((role) => `<div><label for="model-${role}">${role} \xB7 ${role === "A" ? text("Coordinate", "\u8C03\u5EA6") : role === "B" ? text("Develop", "\u5F00\u53D1") : text("Review", "\u9A8C\u6536")}</label><input id="model-${role}" name="model-${role}" value="${esc(c.models[role])}" placeholder="${text("Tool default", "\u5DE5\u5177\u9ED8\u8BA4")}" maxlength="160"></div>`).join("")}</div><p class="small-print">${text("A Skill cannot switch the current conversation model. Sub-agent support and model selection depend on the host tool.", "Skill \u65E0\u6CD5\u5207\u6362\u5F53\u524D\u5BF9\u8BDD\u6A21\u578B\u3002\u5B50 Agent \u80FD\u529B\u53CA\u6A21\u578B\u9009\u62E9\u4EE5\u5BBF\u4E3B\u5DE5\u5177\u4E3A\u51C6\u3002")}</p></div><div class="form-row"><label><input id="remote-enabled" name="remote-enabled" type="checkbox" ${c.remote.enabled ? "checked" : ""}>${text("Enable GitHub / Git remote sync", "\u5F00\u542F GitHub / Git \u8FDC\u7AEF\u540C\u6B65")}</label><div class="form-grid"><div><label for="remote-url">${text("Repository URL (without credentials)", "\u4ED3\u5E93\u5730\u5740\uFF08\u4E0D\u542B\u51ED\u8BC1\uFF09")}</label><input id="remote-url" name="remote-url" type="text" value="${esc(c.remote.url)}" placeholder="https://github.com/owner/repo.git"></div><div><label for="remote-branch">${text("Tracked branch", "\u8DDF\u8E2A\u5206\u652F")}</label><input id="remote-branch" name="remote-branch" value="${esc(c.remote.branch)}" placeholder="main"></div></div><p class="small-print">${text("Remote analysis uses a separate cache. It does not pull or merge into your local branch.", "\u8FDC\u7AEF\u5206\u6790\u4F7F\u7528\u72EC\u7ACB\u7F13\u5B58\uFF0C\u4E0D\u4F1A\u62C9\u53D6\u6216\u5408\u5E76\u5230\u4F60\u7684\u672C\u5730\u5206\u652F\u3002")}</p></div><details class="form-row"><summary style="font-size:12px;cursor:pointer">${text("Automatic analysis & update settings", "\u81EA\u52A8\u5206\u6790\u4E0E\u66F4\u65B0\u8BBE\u7F6E")}</summary><div class="form-row"><label><input id="analysis-enabled" name="analysis-enabled" type="checkbox" ${c.analysis.enabled ? "checked" : ""}>${text("Enable configured background analysis", "\u5F00\u542F\u5DF2\u914D\u7F6E\u7684\u540E\u53F0\u5206\u6790")}</label><label for="analysis-command">${text("Runner command \xB7 JSON array, no shell expansion", "\u8FD0\u884C\u547D\u4EE4 \xB7 JSON \u6570\u7EC4\uFF0C\u4E0D\u7ECF\u8FC7 Shell \u5C55\u5F00")}</label><textarea id="analysis-command" name="analysis-command" spellcheck="false" readonly placeholder='["your-runner", "argument"]'>${esc(JSON.stringify(c.analysis.command))}</textarea><p class="small-print">${text("Set executable runner commands in the local .nativue/config.json file after verifying the input/output contract. This field is read only. Without a supported runner, analysis waits for your next Agent session.", "\u8BF7\u5728\u672C\u5730 .nativue/config.json \u4E2D\u914D\u7F6E\u8FD0\u884C\u547D\u4EE4\uFF0C\u5E76\u5148\u6838\u5BF9\u8F93\u5165\u8F93\u51FA\u534F\u8BAE\u3002\u6B64\u5904\u53EA\u8BFB\u3002\u672A\u914D\u7F6E\u53EF\u7528\u8FD0\u884C\u5668\u65F6\uFF0C\u5206\u6790\u5C06\u7B49\u5F85\u4E0B\u4E00\u6B21 Agent \u4F1A\u8BDD\u3002")}</p></div><div class="form-grid"><div><label for="max-calls">${text("Maximum AI calls per day", "\u6BCF\u65E5 AI \u8C03\u7528\u4E0A\u9650")}</label><input type="number" id="max-calls" name="max-calls" min="1" max="1000" value="${c.analysis.maxCallsPerDay}"></div><div><label for="analysis-interval">${text("Minimum analysis interval (seconds)", "\u6700\u77ED\u5206\u6790\u95F4\u9694\uFF08\u79D2\uFF09")}</label><input type="number" id="analysis-interval" name="analysis-interval" min="1" value="${c.analysis.minIntervalMs / 1e3}"></div><div><label for="remote-interval">${text("Remote check interval (seconds)", "\u8FDC\u7AEF\u68C0\u67E5\u95F4\u9694\uFF08\u79D2\uFF09")}</label><input type="number" id="remote-interval" name="remote-interval" min="30" value="${c.remote.intervalMs / 1e3}"></div><div><label for="debounce">${text("File change quiet period (seconds)", "\u6587\u4EF6\u53D8\u5316\u5408\u5E76\u7B49\u5F85\uFF08\u79D2\uFF09")}</label><input type="number" id="debounce" name="debounce" min="1" value="${c.refresh.debounceMs / 1e3}"></div></div><div class="form-row"><label for="exclusions">${text("Extra excluded paths \xB7 one per line", "\u989D\u5916\u6392\u9664\u8DEF\u5F84 \xB7 \u6BCF\u884C\u4E00\u6761")}</label><textarea id="exclusions" name="exclusions" spellcheck="false">${esc(c.exclude.join("\n"))}</textarea></div></details><div class="form-actions"><button type="submit" class="primary">${text("Save configuration", "\u4FDD\u5B58\u914D\u7F6E")}</button></div><p id="settings-error" class="description danger" role="alert"></p></form>`
  );
  shell.querySelector("#settings-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const form = new FormData(ev.target);
    const config = structuredClone(c);
    try {
      const command = JSON.parse(String(form.get("analysis-command")));
      if (!Array.isArray(command) || !command.every((v) => typeof v === "string"))
        throw new Error(
          text(
            "Runner command must be a JSON array of strings.",
            "\u8FD0\u884C\u547D\u4EE4\u5FC5\u987B\u662F\u5B57\u7B26\u4E32\u7EC4\u6210\u7684 JSON \u6570\u7EC4\u3002"
          )
        );
      config.language = lang;
      config.tool = form.get("tool");
      config.mode = form.get("mode");
      for (const role of ["A", "B", "C"])
        config.models[role] = String(form.get("model-" + role) || "").trim();
      config.remote = {
        ...c.remote,
        enabled: form.has("remote-enabled"),
        url: String(form.get("remote-url") || "").trim(),
        branch: String(form.get("remote-branch") || "main").trim(),
        intervalMs: Number(form.get("remote-interval")) * 1e3
      };
      config.analysis = {
        ...c.analysis,
        enabled: form.has("analysis-enabled"),
        command,
        maxCallsPerDay: Number(form.get("max-calls")),
        minIntervalMs: Number(form.get("analysis-interval")) * 1e3
      };
      config.refresh.debounceMs = Number(form.get("debounce")) * 1e3;
      config.exclude = String(form.get("exclusions") || "").split("\n").map((s) => s.trim()).filter(Boolean);
      await api("/api/config", { config });
      closeModal();
      await refresh();
      toast(text("Workspace settings saved.", "\u5DE5\u4F5C\u533A\u914D\u7F6E\u5DF2\u4FDD\u5B58\u3002"));
    } catch (e) {
      shell.querySelector("#settings-error").textContent = e instanceof Error ? e.message : String(e);
    }
  });
}
function openHelp() {
  openModal(
    text("A clearer way to build.", "\u8BA9\u5F00\u53D1\u8FC7\u7A0B\u66F4\u6E05\u695A\u3002"),
    `<p>${text("Nativue connects an evidence-based architecture canvas with an explicit A / B / C workflow. It works with your own repository and AI tools.", "Nativue \u5C06\u6709\u6E90\u7801\u8BC1\u636E\u7684\u67B6\u6784\u753B\u5E03\u4E0E A / B / C \u534F\u4F5C\u6D41\u7A0B\u8FDE\u5728\u4E00\u8D77\uFF0C\u914D\u5408\u4F60\u7684\u4EE3\u7801\u5E93\u548C AI \u5DE5\u5177\u4F7F\u7528\u3002")}</p><h3>01 \xB7 ${text("Map your workspace", "\u7406\u89E3\u5DE5\u4F5C\u533A")}</h3><p>${text("Initialize with the CLI, then use the Nativue Skill in your AI tool to inspect the indexed files and write an architecture snapshot. Select any module to reveal and scroll to its source files.", "\u5148\u901A\u8FC7 CLI \u521D\u59CB\u5316\uFF0C\u518D\u8BA9 AI \u5DE5\u5177\u4F7F\u7528 Nativue Skill \u9605\u8BFB\u5DF2\u7D22\u5F15\u6587\u4EF6\u5E76\u751F\u6210\u67B6\u6784\u5FEB\u7167\u3002\u70B9\u51FB\u6A21\u5757\u540E\uFF0C\u6E90\u6587\u4EF6\u680F\u4F1A\u5C55\u5F00\u76EE\u5F55\u5E76\u76F4\u63A5\u6EDA\u52A8\u5230\u76EE\u6807\u6587\u4EF6\u3002")}</p><pre>nativue init .
nativue serve</pre><h3>02 \xB7 ${text("Choose how to collaborate", "\u9009\u62E9\u534F\u4F5C\u65B9\u5F0F")}</h3><p>${text("Open independent A / B / C conversations, or let A create sub-agents when the host tool supports them. Use the shared ledger and handoff prompts instead of relying on chat memory.", "\u53EF\u4EE5\u72EC\u7ACB\u5F00\u542F A / B / C \u5BF9\u8BDD\uFF0C\u4E5F\u53EF\u4EE5\u5728\u5DE5\u5177\u652F\u6301\u65F6\u8BA9 A \u8C03\u5EA6\u5B50 Agent\u3002\u4F7F\u7528\u5171\u4EAB\u53F0\u8D26\u548C\u4EA4\u63A5\u6307\u4EE4\u63A5\u7EED\u5DE5\u4F5C\u3002")}</p><h3>03 \xB7 ${text("Keep acceptance independent", "\u4FDD\u6301\u72EC\u7ACB\u9A8C\u6536")}</h3><p>${text("B supplies a frozen development commit. C independently checks that version and records evidence. Integration requires a separate C review against the integration commit. User acceptance is a separate final step.", "B \u63D0\u4F9B\u51BB\u7ED3\u7684\u5F00\u53D1\u63D0\u4EA4\u3002C \u72EC\u7ACB\u9A8C\u6536\u8BE5\u7248\u672C\u5E76\u8BB0\u5F55\u8BC1\u636E\u3002\u96C6\u6210\u63D0\u4EA4\u9700\u8981\u5355\u72EC\u7684 C \u590D\u9A8C\uFF0C\u6700\u540E\u7531\u7528\u6237\u624B\u6D4B\u786E\u8BA4\u3002")}</p><h3>04 \xB7 ${text("Stay current, visibly", "\u770B\u6E05\u66F4\u65B0\u72B6\u6001")}</h3><p>${text("While the local service runs, file indexing and task changes refresh automatically. Semantic analysis needs a configured runner or an active Agent session. A stale canvas stays visible with its version and status. Git remote sync is optional and uses its own snapshot.", "\u672C\u5730\u670D\u52A1\u8FD0\u884C\u65F6\uFF0C\u6587\u4EF6\u7D22\u5F15\u548C\u4EFB\u52A1\u53D8\u5316\u4F1A\u81EA\u52A8\u5237\u65B0\u3002\u8BED\u4E49\u5206\u6790\u9700\u8981\u5DF2\u914D\u7F6E\u7684\u8FD0\u884C\u5668\u6216 Agent \u4F1A\u8BDD\u3002\u65E7\u753B\u5E03\u4FDD\u7559\u5176\u7248\u672C\u548C\u8FC7\u671F\u72B6\u6001\u3002Git \u8FDC\u7AEF\u540C\u6B65\u53EF\u9009\uFF0C\u5E76\u4F7F\u7528\u72EC\u7ACB\u5FEB\u7167\u3002")}</p><div class="section-divider"></div><p class="small-print">${text("Compatibility is capability-specific. Selecting an AI tool does not mean its automatic orchestration has been verified on this machine.", "\u517C\u5BB9\u6027\u6309\u5177\u4F53\u80FD\u529B\u533A\u5206\u3002\u9009\u62E9\u67D0\u4E2A AI \u5DE5\u5177\uFF0C\u4E0D\u4EE3\u8868\u672C\u673A\u5DF2\u7ECF\u9A8C\u8BC1\u8BE5\u5DE5\u5177\u7684\u81EA\u52A8\u8C03\u5EA6\u3002")}</p><p>SienGe AI Lab \xB7 \u5C0F\u7EA2\u4E66\uFF1ASienGe\u7684AI\u5B9E\u9A8C\u5BA4</p>`
  );
}
async function getRole(role) {
  const id = selectedTask ? `&id=${encodeURIComponent(selectedTask)}` : "";
  return (await api(`/api/handoff?role=${role}${id}`)).text;
}
async function copyRole(role) {
  try {
    const value = await getRole(role);
    await navigator.clipboard.writeText(value);
    toast(
      text(
        `${role} instructions copied. Paste into the intended Agent conversation.`,
        `${role} \u6307\u4EE4\u5DF2\u590D\u5236\uFF0C\u8BF7\u7C98\u8D34\u5230\u5BF9\u5E94 Agent \u5BF9\u8BDD\u3002`
      )
    );
  } catch (e) {
    openRoles(role);
  }
}
function openRoles(initial = "A") {
  const shell = openModal(
    text("Give every Agent a clear role.", "\u7ED9\u6BCF\u4E2A Agent \u6E05\u695A\u7684\u804C\u8D23\u3002"),
    `<p>${data?.config.mode === "automatic" ? text("Start A in your selected tool. Ask A to use native sub-agents only when that capability is available. Roles and versioned acceptance remain separate.", "\u5728\u6240\u9009\u5DE5\u5177\u4E2D\u542F\u52A8 A\u3002\u4EC5\u5728\u5BBF\u4E3B\u652F\u6301\u65F6\u4F7F\u7528\u539F\u751F\u5B50 Agent\uFF0C\u59CB\u7EC8\u4FDD\u6301\u89D2\u8272\u548C\u7248\u672C\u9A8C\u6536\u72EC\u7ACB\u3002") : text("Open a separate conversation for each role. Paste its handoff prompt, then use the shared ledger to keep the work connected.", "\u4E3A\u5404\u89D2\u8272\u5F00\u542F\u72EC\u7ACB\u5BF9\u8BDD\uFF0C\u7C98\u8D34\u4EA4\u63A5\u6307\u4EE4\uFF0C\u901A\u8FC7\u5171\u4EAB\u53F0\u8D26\u63A5\u7EED\u5DE5\u4F5C\u3002")}</p><div class="role-buttons">${["A", "B", "C"].map((role) => `<button data-modal-role="${role}">${role} \xB7 ${role === "A" ? text("Coordinator", "\u8C03\u5EA6") : role === "B" ? text("Developer", "\u5F00\u53D1") : text("Reviewer", "\u9A8C\u6536")}</button>`).join("")}</div><pre id="role-text">${text("Loading instructions\u2026", "\u6B63\u5728\u8BFB\u53D6\u6307\u4EE4\u2026")}</pre><div class="form-actions"><button class="primary" id="copy-role-text">${text("Copy instructions", "\u590D\u5236\u6307\u4EE4")}</button></div><p class="small-print">${text("Tool capability varies. WorkBuddy automatic sub-agent support is not assumed. Models are configured per role in Settings and selected through your host tool.", "\u5404\u5DE5\u5177\u80FD\u529B\u4E0D\u540C\uFF0C\u4E0D\u9ED8\u8BA4\u5047\u8BBE WorkBuddy \u652F\u6301\u81EA\u52A8\u5B50 Agent\u3002\u89D2\u8272\u6A21\u578B\u53EF\u5728\u8BBE\u7F6E\u4E2D\u8BB0\u5F55\uFF0C\u5E76\u5728\u5BBF\u4E3B\u5DE5\u5177\u4E2D\u9009\u62E9\u3002")}</p>`
  );
  let current = "";
  const load = async (role) => {
    try {
      current = await getRole(role);
      shell.querySelector("#role-text").textContent = current;
    } catch (e) {
      current = "";
      shell.querySelector("#role-text").textContent = String(e);
    }
  };
  shell.querySelectorAll("[data-modal-role]").forEach(
    (b) => b.addEventListener("click", () => void load(b.dataset.modalRole))
  );
  shell.querySelector("#copy-role-text").addEventListener("click", () => {
    if (current)
      void navigator.clipboard.writeText(current).then(() => toast(text("Instructions copied.", "\u6307\u4EE4\u5DF2\u590D\u5236\u3002"))).catch(
        () => toast(
          text(
            "Select and copy the instructions above.",
            "\u8BF7\u9009\u4E2D\u5E76\u590D\u5236\u4E0A\u65B9\u6307\u4EE4\u3002"
          )
        )
      );
  });
  void load(initial);
}
function openTask(task) {
  if (!data) return;
  const revision = data.ledger.revision;
  const currentStatus = task?.status || "todo";
  const input = (field, label, value = "", attributes = "") => `<label for="task-${field}">${label}</label><input id="task-${field}" name="task-${field}" value="${esc(value)}" ${attributes}>`;
  const textarea = (field, label, value = "", attributes = "") => `<label for="task-${field}">${label}</label><textarea id="task-${field}" name="task-${field}" ${attributes}>${esc(value)}</textarea>`;
  const options = (values, value, label) => values.map((option) => `<option value="${esc(option)}" ${value === option ? "selected" : ""}>${esc(label(option))}</option>`).join("");
  const shell = openModal(task ? text("Edit task", "\u7F16\u8F91\u4EFB\u52A1") : text("New task", "\u65B0\u5EFA\u4EFB\u52A1"), `
    <form id="task-form">
      ${task ? `<p class="fine">${esc(task.id)}</p>` : ""}
      <div class="form-row">${input("title", text("Task title", "\u4EFB\u52A1\u540D\u79F0"), task?.title, 'required maxlength="240"')}</div>
      <div class="form-grid form-row">
        <div>${input("module", text("Module (optional)", "\u6240\u5C5E\u6A21\u5757\uFF08\u53EF\u9009\uFF09"), task?.module, 'maxlength="80"')}</div>
        <div><label for="task-priority">${text("Priority", "\u4F18\u5148\u7EA7")}</label><select id="task-priority" name="task-priority">${options(["P1", "P0", "P2"], task?.priority || "P1", (value) => value)}</select></div>
      </div>
      ${task ? `
        <div class="form-grid form-row">
          <div><label for="task-progress">${text("Board status", "\u770B\u677F\u72B6\u6001")}</label><select id="task-progress" name="task-progress">${options(["", ...taskProgressOptions], task.progress || "", (value) => value ? progressLabel(value) : text("Follow handoff stage", "\u8DDF\u968F\u4EA4\u63A5\u9636\u6BB5"))}</select></div>
          <div>${input("branch", text("Branch", "\u5206\u652F"), task.branch)}</div>
        </div>
        <p id="task-scope-help" class="fine" hidden>${text("The review scope is frozen. Restart development from rework to revise it.", "\u9A8C\u6536\u8303\u56F4\u5DF2\u9501\u5B9A\u3002\u9000\u56DE\u8FD4\u5DE5\u5E76\u91CD\u65B0\u5F00\u53D1\u65F6\u53EF\u4FEE\u8BA2\u3002")}</p>
      ` : ""}
      <div class="form-row">${textarea("description", text("Task description", "\u4EFB\u52A1\u63CF\u8FF0"), task?.description, task ? "" : "required")}</div>
      <div class="form-row">${textarea("criteria", text("Acceptance criteria \xB7 one per line", "\u9A8C\u6536\u6807\u51C6 \xB7 \u6BCF\u884C\u4E00\u6761"), task?.criteria.join("\n"), task ? "" : "required")}</div>
      <div class="form-row">${textarea("acceptance-notes", text("Acceptance evidence \xB7 notes", "\u9A8C\u6536\u8BC1\u636E \xB7 \u8865\u5145\u8BB0\u5F55"), task?.acceptanceNotes, 'maxlength="12000"')}</div>
      ${task ? `
        <details id="task-assignment" class="form-row">
          <summary>${text("Ownership, scope & references", "\u5206\u5DE5\u3001\u8303\u56F4\u548C\u53C2\u8003")}</summary>
          <div class="form-grid form-row">
            <div>${input("owner", text("Owner", "\u8BA4\u9886\u4EBA"), task.owner)}</div>
            <div>${input("developer", text("Developer", "\u5F00\u53D1\u8005"), task.developer)}</div>
            <div>${input("reviewer", text("Assigned reviewer", "\u9A8C\u6536\u4EBA"), task.reviewer)}</div>
            <div>${input("base-commit", text("Base commit", "\u57FA\u7EBF\u63D0\u4EA4"), task.baseCommit)}</div>
            <div>${input("issue", text("Issue reference", "Issue \u7F16\u53F7\u6216\u5730\u5740"), task.issue)}</div>
            <div>${input("blocked", text("Blocker", "\u963B\u585E\u8BF4\u660E"), task.blocked)}</div>
          </div>
          <div class="form-row">${textarea("files", text("File scope \xB7 one per line", "\u6587\u4EF6\u8303\u56F4 \xB7 \u6BCF\u884C\u4E00\u6761"), task.files.join("\n"))}</div>
          <div class="form-row">${textarea("depends-on", text("Prerequisite IDs \xB7 one per line", "\u524D\u7F6E\u4EFB\u52A1 ID \xB7 \u6BCF\u884C\u4E00\u6761"), task.dependsOn.join("\n"))}</div>
        </details>
        <details id="task-workflow" class="form-row">
          <summary>${text("A/B/C handoff", "A/B/C \u4EA4\u63A5")} \xB7 ${esc(statusLabel(currentStatus))}</summary>
          <div class="form-row"><label for="task-status">${text("Handoff stage", "\u4EA4\u63A5\u9636\u6BB5")}</label><select id="task-status" name="task-status">${options([currentStatus, ...taskTransitions[currentStatus]], currentStatus, statusLabel)}</select></div>
          <fieldset id="task-freeze-step" class="task-transition" hidden disabled>
            <div class="form-row">${input("version", "", "", 'required pattern="[0-9a-fA-F]{40}" maxlength="40" spellcheck="false"')}</div>
          </fieldset>
          <fieldset id="task-review-step" class="task-transition" hidden disabled>
            <p class="fine">${text("Review commit", "\u9A8C\u6536\u63D0\u4EA4")} <code>${esc(currentStatus === "integration-review" ? task.integrationCommit : task.commit)}</code></p>
            <div class="form-row">${textarea("review-report", text("Independent review report", "\u72EC\u7ACB\u9A8C\u6536\u62A5\u544A"), "", "required")}</div>
            <div class="form-row">${textarea("untested", text("Untested items \xB7 one per line", "\u672A\u9A8C\u8BC1\u9879 \xB7 \u6BCF\u884C\u4E00\u6761"))}</div>
          </fieldset>
          <fieldset id="task-handtest-step" class="task-transition" hidden disabled>
            <p class="fine">${text("Handtest commit", "\u624B\u6D4B\u63D0\u4EA4")} <code>${esc(task.integrationCommit)}</code></p>
            <div class="form-row">${textarea("handtest-source", text("User handtest result and evidence", "\u7528\u6237\u624B\u6D4B\u7ED3\u679C\u53CA\u4F9D\u636E"), "", "required")}</div>
          </fieldset>
        </details>
      ` : `<div class="form-row">${input("issue", text("Issue reference (optional)", "Issue \u7F16\u53F7\u6216\u5730\u5740\uFF08\u53EF\u9009\uFF09"))}</div>`}
      <div class="form-row">${input("actor", text("Recorded actor", "\u8BB0\u5F55\u64CD\u4F5C\u8005"), "user", 'required maxlength="160"')}</div>
      <p id="task-error" role="alert" class="description danger"></p>
      <div class="form-actions">
        <button type="button" id="task-cancel">${text("Cancel", "\u53D6\u6D88")}</button>
        <button class="primary" type="submit">${task ? text("Save changes", "\u4FDD\u5B58\u4FEE\u6539") : text("Create task", "\u521B\u5EFA\u4EFB\u52A1")}</button>
      </div>
    </form>`);
  const form = shell.querySelector("#task-form");
  const workflow = form.querySelector("#task-status");
  const actorField = form.querySelector("#task-actor");
  form.addEventListener("invalid", (event) => {
    const details = event.target.closest("details");
    if (details) details.open = true;
  }, true);
  const workflowStatus = () => workflow?.value || currentStatus;
  const isReview = () => workflowStatus() !== currentStatus && (currentStatus === "review" || currentStatus === "integration-review");
  let customActor = false;
  actorField.addEventListener("input", () => {
    customActor = true;
  });
  if (task && workflow) {
    const step = (name, visible) => {
      const fieldset = form.querySelector(`#task-${name}-step`);
      fieldset.hidden = !visible;
      fieldset.disabled = !visible;
    };
    const syncStatus = () => {
      const next = workflowStatus();
      const advancing = currentStatus !== next;
      const scopeEditable = canEditTaskScope(currentStatus, next);
      const owner = form.querySelector("#task-owner");
      const developer = form.querySelector("#task-developer");
      developer.readOnly = currentStatus !== "todo" && !(currentStatus === "rework" && next === "developing");
      for (const name of ["description", "criteria", "files", "depends-on"]) {
        form.querySelector(`#task-${name}`).readOnly = !scopeEditable;
      }
      form.querySelector("#task-scope-help").hidden = scopeEditable;
      step("freeze", advancing && (next === "review" || next === "integrated"));
      form.querySelector('label[for="task-version"]').textContent = next === "integrated" ? text("Integration commit \xB7 full SHA", "\u96C6\u6210\u63D0\u4EA4 \xB7 \u5B8C\u6574 SHA") : text("Development commit \xB7 full SHA", "\u5F00\u53D1\u63D0\u4EA4 \xB7 \u5B8C\u6574 SHA");
      step("review", isReview());
      step("handtest", advancing && next === "done");
      if (!customActor) {
        actorField.value = isReview() ? "" : !advancing || next === "done" ? "user" : owner.value || "user";
      }
      if (advancing && next === "developing") {
        form.querySelector("#task-assignment").open = true;
        owner.placeholder = actorField.value;
        developer.placeholder = owner.value || actorField.value;
      }
    };
    workflow.addEventListener("change", syncStatus);
    syncStatus();
  }
  shell.querySelector("#task-cancel").addEventListener("click", closeModal);
  const submit = form.querySelector('[type="submit"]');
  const message = form.querySelector("#task-error");
  const initial = new FormData(form);
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (submit.disabled) return;
    submit.disabled = true;
    message.textContent = "";
    const values = new FormData(form);
    const value = (name) => String(values.get(`task-${name}`) ?? "").trim();
    const lines = (name) => value(name).split("\n").map((line) => line.trim()).filter(Boolean);
    const changed = (name) => values.get(`task-${name}`) !== initial.get(`task-${name}`);
    const edited = (name, previous) => !task || changed(name) ? value(name) || void 0 : previous;
    const actor = value("actor");
    const at = (/* @__PURE__ */ new Date()).toISOString();
    const next = {
      ...task || { id: `TASK-${crypto.randomUUID().slice(0, 8)}`, criteria: [], files: [], dependsOn: [], reviews: [] },
      title: edited("title", task?.title) || "",
      module: edited("module", task?.module),
      priority: value("priority"),
      status: workflowStatus(),
      description: task?.description || "",
      acceptanceNotes: edited("acceptance-notes", task?.acceptanceNotes),
      issue: edited("issue", task?.issue),
      updatedAt: at
    };
    if (canEditTaskScope(currentStatus, next.status)) {
      next.description = edited("description", task?.description) || "";
      if (!task || changed("criteria")) next.criteria = lines("criteria");
      if (!task || changed("files")) next.files = lines("files");
      if (!task || changed("depends-on")) next.dependsOn = lines("depends-on");
    }
    if (task) {
      if (changed("progress")) next.progress = value("progress") || null;
      Object.assign(next, {
        branch: edited("branch", task.branch),
        owner: edited("owner", task.owner),
        developer: edited("developer", task.developer),
        reviewer: edited("reviewer", task.reviewer),
        baseCommit: edited("base-commit", task.baseCommit),
        blocked: edited("blocked", task.blocked)
      });
      if (currentStatus !== next.status) {
        if (next.status === "developing") {
          next.owner ||= actor;
          next.developer ||= next.owner;
        }
        if (next.status === "review") next.commit = value("version");
        if (next.status === "integrated") next.integrationCommit = value("version");
        if (isReview()) {
          const review = {
            reviewer: actor,
            commit: currentStatus === "integration-review" ? task.integrationCommit : task.commit,
            passed: next.status !== "rework",
            report: value("review-report"),
            untested: lines("untested"),
            at
          };
          if (currentStatus === "integration-review") next.integrationReview = review;
          else next.reviews = [...task.reviews, review];
        }
        if (next.status === "done") {
          next.userAcceptance = { commit: task.integrationCommit, source: value("handtest-source"), at };
        }
      }
    }
    try {
      await api("/api/tasks", { revision, actor, task: next });
      selectedTask = next.id;
      if (!task) viewMode = "parallel";
      if (shell.isConnected) closeModal();
      await refresh();
      toast(text("Task ledger updated.", "\u4EFB\u52A1\u53F0\u8D26\u5DF2\u66F4\u65B0\u3002"));
    } catch (e) {
      message.textContent = e instanceof Error ? e.message : String(e);
    } finally {
      submit.disabled = false;
    }
  });
}
async function showSource(path) {
  if (!path) return;
  abortFile?.abort();
  abortFile = new AbortController();
  const shell = openModal(
    path,
    `<p>${esc(source === "remote" ? text("Remote snapshot \xB7 read only", "\u8FDC\u7AEF\u5FEB\u7167 \xB7 \u53EA\u8BFB") : text("Local source \xB7 read only", "\u672C\u5730\u6E90\u7801 \xB7 \u53EA\u8BFB"))}</p><pre id="source-content">${text("Loading source\u2026", "\u6B63\u5728\u8BFB\u53D6\u6E90\u7801\u2026")}</pre>`,
    true
  );
  try {
    const r = await fetch(
      `/api/file?path=${encodeURIComponent(path)}&source=${source}`,
      { signal: abortFile.signal }
    );
    const value = await r.json();
    if (!r.ok) throw new Error(value.error || `HTTP ${r.status}`);
    shell.querySelector("#source-content").innerHTML = String(value.content).split("\n").map(
      (line, i) => `<span class="code-line"><span class="line-no">${i + 1}</span>${esc(line)}</span>`
    ).join("");
  } catch (e) {
    if (e.name !== "AbortError")
      shell.querySelector("#source-content").textContent = String(e);
  }
}
void refresh();
var events = new EventSource("/api/events");
events.onmessage = () => void refresh();
events.onerror = () => {
  if (data && !error) {
    error = text(
      "Live connection interrupted. Reconnecting\u2026",
      "\u5B9E\u65F6\u8FDE\u63A5\u4E2D\u65AD\uFF0C\u6B63\u5728\u91CD\u8FDE\u2026"
    );
    render();
  }
};
events.onopen = () => {
  if (error) {
    error = "";
    void refresh();
  }
};
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) void refresh();
});
window.addEventListener("pagehide", () => {
  if (layoutSaveTimer !== void 0) rememberMap();
});
