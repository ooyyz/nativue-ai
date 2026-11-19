import fs from "node:fs";
import path from "node:path";
import type { RuntimeState, Snapshot } from "./types.ts";
import { isSourcePathAllowed, scanWorkspace } from "./scanner.ts";
import { syncRemote } from "./remote.ts";
import { syncIssues } from "./issues.ts";
import {
  readConfig,
  readSnapshot,
  saveSnapshot,
  atomicJson,
  stateDir,
} from "./store.ts";
import { analysisRequest, runAnalysis } from "./analysis.ts";
import { claimAnalysis, readBudget } from "./analysis-lock.ts";
import { refreshJavaGraph, javaConfigId } from "./java/graph.ts";
export class Runtime {
  root: string;
  state: RuntimeState;
  listeners = new Set<() => void>();
  watchers = new Map<string, fs.FSWatcher>();
  timers: ReturnType<typeof setInterval>[] = [];
  pending: ReturnType<typeof setTimeout> | null = null;
  scanning = false;
  scanPromise: Promise<Snapshot | undefined> | null = null;
  closed = false;
  lastStateStamp = 0;
  analysisAbort: AbortController | null = null;
  activeAnalysis: Promise<Snapshot | null> | null = null;
  remoteAbort: AbortController | null = null;
  activeRemote: Promise<Snapshot> | null = null;
  remoteBusy = false;
  remoteNextAttempt = 0;
  remoteFailures = 0;
  constructor(root: string) {
    this.root = root;
    const b = readBudget(root);
    this.state = {
      running: false,
      paused: false,
      analysisCalls: b.calls,
      analysisDay: b.day,
      analyzing: false,
      changedFiles: [],
    };
  }
  emit() {
    const b = readBudget(this.root);
    this.state.analysisCalls = b.calls;
    this.state.analysisDay = b.day;
    atomicJson(
      path.join(stateDir(this.root), "runtime-state.json"),
      this.state,
    );
    for (const fn of this.listeners) fn();
  }
  async scan(force = false): Promise<Snapshot | undefined> {
    if (this.closed || (this.state.paused && !force)) return;
    if (this.scanPromise) return this.scanPromise;
    this.scanning = true;
    this.scanPromise = this.performScan();
    try {
      return await this.scanPromise;
    } finally {
      this.scanPromise = null;
      this.scanning = false;
      if (!this.closed) {
        if (this.state.running) {
          this.refreshWatchers();
        }
        this.emit();
      }
    }
  }
  private async performScan() {
    try {
      const previous = readSnapshot(this.root),
        scanned = await scanWorkspace(this.root);
      if (this.closed) return;
      this.state.lastScan = new Date().toISOString();
      const config = readConfig(this.root);
      if (previous?.id === scanned.id && (!config.java?.enabled || previous.java?.configId === javaConfigId(config.java))) return previous;
      const old = new Map(previous?.files.map((f) => [f.path, f.hash]));
      this.state.changedFiles = [
        ...scanned.files
          .filter((f) => old.get(f.path) !== f.hash)
          .map((f) => f.path),
        ...(previous?.files
          .filter((f) => !scanned.files.some((n) => n.path === f.path))
          .map((f) => f.path) || []),
      ];
      let next = scanned;
      if (
        previous &&
        ["complete", "stale", "failed"].includes(previous.analysis.status)
      ) {
        const available = new Set(scanned.files.map((f) => f.path));
        const modules = previous.modules
          .map((m) => ({
            ...m,
            files: m.files.filter((f) => available.has(f)),
            evidence: m.evidence.filter((e) => available.has(e.path)),
          }))
          .filter((m) => m.files.length && m.evidence.length);
        const ids = new Set(modules.map((m) => m.id)),
          assigned = new Set(modules.flatMap((m) => m.files));
        // Keep surviving children reachable if a removed parent loses all evidence.
        for (const m of modules)
          if (m.parentId && !ids.has(m.parentId)) delete m.parentId;
        const mergedModules = new Map<string, (typeof modules)[number]>();
        for (const m of [...modules, ...scanned.modules.map(m => ({
          ...m, id: "scan-" + m.id, files: m.files.filter(f => !assigned.has(f)),
        })).filter(m => m.files.length)]) {
          const existing = mergedModules.get(m.id);
          mergedModules.set(m.id, existing ? {...existing,
            files: [...new Set([...existing.files, ...m.files])],
            evidence: [...new Map([...existing.evidence, ...m.evidence].map(e => [JSON.stringify(e), e])).values()],
          } : m);
        }
        next = {
          ...scanned,
          modules: [...mergedModules.values()],
          edges: previous.edges.filter(
            (e) =>
              ids.has(e.from) &&
              ids.has(e.to) &&
              e.evidence.every((p) => available.has(p.path)),
          ),
          journeys: previous.journeys.filter((j) =>
            j.steps.every(
              (st) =>
                ids.has(st.moduleId) &&
                st.evidence.every((e) => available.has(e.path)),
            ),
          ),
          analysis: {
            ...previous.analysis,
            status: "stale",
            inputId: scanned.id,
          },
        };
      }
      if (config.java?.enabled)
        next = refreshJavaGraph(this.root, next, config.java, previous || undefined, config.language);
      if (this.closed) return;
      saveSnapshot(this.root, next);
      analysisRequest(this.root, next, this.state.changedFiles);
      this.state.error = undefined;
      return next;
    } catch (e) {
      this.state.error = (e as Error).message;
      throw e;
    }
  }
  async analyze(force = false, kind: "local" | "remote" = "local") {
    if (this.closed || this.state.analyzing || (this.state.paused && !force))
      return;
    const c = readConfig(this.root),
      s = readSnapshot(this.root, kind);
    if (!s) {
      if (force)
        throw Error(
          "No snapshot for the selected source; scan or sync it first",
        );
      return;
    }
    if (!force && (!c.analysis.enabled || s.analysis.status === "complete"))
      return;
    analysisRequest(
      this.root,
      s,
      kind === "local" ? this.state.changedFiles : [],
    );
    if (!c.analysis.command.length) {
      this.emit();
      return;
    }
    let claim;
    try {
      claim = claimAnalysis(
        this.root,
        c.analysis.maxCallsPerDay,
        c.analysis.minIntervalMs,
        force,
      );
    } catch (e) {
      if (!force) return;
      throw e;
    }
    if (!claim) return;
    this.state.analyzing = true;
    this.analysisAbort = new AbortController();
    this.emit();
    try {
      this.activeAnalysis = runAnalysis(
        this.root,
        s,
        c,
        kind === "local" ? this.state.changedFiles : [],
        this.analysisAbort.signal,
      );
      await this.activeAnalysis;
      this.state.error = undefined;
    } catch (e) {
      if (!this.closed) {
        const current = readSnapshot(this.root, kind);
        if (current?.id === s.id) {
          current.analysis = {
            ...current.analysis,
            status: "failed",
            error: (e as Error).message,
          };
          saveSnapshot(this.root, current);
        }
        this.state.error = (e as Error).message;
      }
      throw e;
    } finally {
      claim.release();
      this.analysisAbort = null;
      this.activeAnalysis = null;
      this.state.analyzing = false;
      if (!this.closed) this.emit();
    }
  }
  async remote(force = false) {
    if (this.closed || this.remoteBusy || (this.state.paused && !force)) return;
    const c = readConfig(this.root);
    if (!c.remote.enabled) throw Error("GitHub sync is not enabled");
    this.remoteBusy = true;
    this.remoteAbort = new AbortController();
    try {
      this.activeRemote = syncRemote(this.root, c, this.remoteAbort.signal);
      let s = await this.activeRemote;
      if (this.closed) return;
      const old = readSnapshot(this.root, "remote");
      if (old?.id === s.id) s = old;
      saveSnapshot(this.root, s);
      analysisRequest(this.root, s);
      this.state.lastRemote = new Date().toISOString();
      this.remoteFailures = 0;
      this.remoteNextAttempt = Date.now() + c.remote.intervalMs;
      await syncIssues(this.root, c, this.remoteAbort.signal);
      if (this.closed) return;
      this.state.error = undefined;
      void this.analyze(false, "remote").catch(() => {});
      return s;
    } catch (e) {
      if (!this.closed) {
        this.remoteFailures++;
        this.remoteNextAttempt =
          Date.now() +
          Math.min(
            1800000,
            c.remote.intervalMs * 2 ** Math.min(this.remoteFailures, 4),
          );
        this.state.error = (e as Error).message;
      }
      throw e;
    } finally {
      this.activeRemote = null;
      this.remoteAbort = null;
      this.remoteBusy = false;
      if (!this.closed) this.emit();
    }
  }
  private refreshWatchers() {
    const config = readConfig(this.root);
    const base = fs.realpathSync(this.root);
    const roots = config.java?.enabled
      ? [config.java, ...(config.java.scopes || [])]
        .flatMap(scope => scope.roots)
        .map(root => path.posix.normalize(root).replace(/\/$/, ""))
      : [];
    const directories = new Set<string>();
    const traversed = new Set<string>();
    const watchError = "Source watching incomplete; periodic reconciliation remains active / 部分源码监听不可用，定期扫描仍在运行";
    if (this.state.error === watchError) {
      this.state.error = undefined;
    }
    const unavailable = () => {
      this.state.error = watchError;
    };
    const accepts = (relative: string) => {
      return isSourcePathAllowed(relative, config.exclude, roots, true) &&
        !/(?:^|\/)src\/test(?:\/|$)/.test(relative);
    };
    const visit = (relative: string, descend: boolean) => {
      if (!accepts(relative) || (descend ? traversed.has(relative) : directories.has(relative))) {
        return;
      }
      try {
        const absolute = path.join(base, relative);
        if (fs.realpathSync(absolute) !== absolute) {
          return;
        }
        const stat = fs.lstatSync(absolute);
        if (stat.isSymbolicLink()) {
          return;
        }
        if (!stat.isDirectory()) {
          visit(path.posix.dirname(relative), false);
          return;
        }
        directories.add(relative);
        if (descend) {
          traversed.add(relative);
          for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
            if (entry.isDirectory() && !entry.isSymbolicLink()) {
              visit(path.posix.join(relative, entry.name), true);
            }
          }
        }
      } catch (error) {
        // 保存或移动目录期间路径可能消失，下次扫描重新建立监听。
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          unavailable();
        }
      }
    };
    if (roots.length) {
      for (const root of roots) {
        const file = root.endsWith(".java");
        visit(file ? path.posix.dirname(root) : root, !file);
      }
    } else {
      for (const file of readSnapshot(this.root)?.files || []) {
        if (accepts(file.path)) {
          const directory = path.posix.dirname(file.path);
          visit(directory, directory !== ".");
        }
      }
    }
    for (const [directory, watcher] of this.watchers) {
      if (!directories.has(directory)) {
        watcher.close();
        this.watchers.delete(directory);
      }
    }
    for (const directory of directories) {
      if (this.watchers.has(directory)) {
        continue;
      }
      try {
        // 逐目录注册，避免 recursive 在过滤前已监听构建产物和整个工程。
        const watcher = fs.watch(path.join(base, directory), (_, file) => {
          const relative = path.posix.join(directory, String(file || "").replaceAll("\\", "/"));
          if (this.closed || this.state.paused || !accepts(relative)) {
            return;
          }
          if (roots.length && !roots.some(root => root === "." || relative === root ||
            relative.startsWith(root + "/") || root.startsWith(relative + "/"))) {
            return;
          }
          if (this.pending) {
            clearTimeout(this.pending);
          }
          this.pending = setTimeout(() => {
            this.pending = null;
            void this.scan().then(() => this.analyze()).catch(() => {});
          }, readConfig(this.root).refresh.debounceMs);
        });
        watcher.on("error", () => {
          watcher.close();
          this.watchers.delete(directory);
          if (!this.closed) {
            unavailable();
            this.emit();
          }
        });
        this.watchers.set(directory, watcher);
      } catch {
        unavailable();
      }
    }
  }
  async start() {
    this.state.running = true;
    await this.scan(true);
    if (this.closed) return;
    this.timers.push(
      setInterval(() => {
        if (this.closed || this.state.paused) return;
        const c = readConfig(this.root);
        if (
          Date.now() - Date.parse(this.state.lastScan || "1970-01-01") >=
          c.refresh.reconcileMs
        )
          void this.scan()
            .then(() => this.analyze())
            .catch(() => {});
        if (c.remote.enabled && Date.now() >= this.remoteNextAttempt)
          void this.remote().catch(() => {});
        const stamp = [
          "ledger.json",
          "local.json",
          "config.json",
          "analysis-budget.json",
          "descriptions.json",
          "architecture-edits.json",
          "layout-requests.json",
        ]
          .map((f) => path.join(stateDir(this.root), f))
          .reduce(
            (sum, f) => sum + (fs.existsSync(f) ? fs.statSync(f).mtimeMs : 0),
            0,
          );
        if (stamp !== this.lastStateStamp) {
          this.lastStateStamp = stamp;
          this.emit();
        }
      }, 1000),
    );
    void this.analyze().catch(() => {});
    this.emit();
  }
  async close() {
    if (this.closed) return;
    this.closed = true;
    for (const watcher of this.watchers.values()) {
      watcher.close();
    }
    this.watchers.clear();
    this.timers.forEach(clearInterval);
    if (this.pending) clearTimeout(this.pending);
    this.analysisAbort?.abort();
    this.remoteAbort?.abort();
    this.state.running = false;
    this.emit();
    await Promise.allSettled(
      [this.scanPromise, this.activeAnalysis, this.activeRemote].filter(
        Boolean,
      ),
    );
  }
}
