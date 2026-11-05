export type Language = "en" | "zh";
export type Tool = "codex" | "claude" | "workbuddy";
export interface FileEntry {
  path: string;
  hash: string;
  size: number;
  language: string;
  moduleId: string;
}
export interface Evidence {
  path: string;
  line?: number;
  note?: string;
}
export interface Module {
  id: string;
  /** Omit for a top-level module; otherwise identify its containing module. */
  parentId?: string;
  name: string;
  nameOrigin?: "manual";
  automaticName?: string;
  parentOrigin?: "manual";
  automaticParentId?: string;
  /** An unavailable manual target is kept dormant, with the automatic parent displayed. */
  pendingParentId?: string;
  description: string;
  descriptionOrigin?: "source-comment" | "generated" | "manual";
  automaticDescription?: string;
  descriptionEvidence?: Evidence[];
  kind: string;
  files: string[];
  evidence: Evidence[];
  confidence: "observed" | "inferred" | "verified";
  x?: number;
  y?: number;
  generator?: "java";
  level?: "feature" | "class" | "method";
  symbol?: string;
  /** Java declaration metadata; distinct from the editable feature parent. */
  typeKind?: "class" | "interface" | "enum" | "record";
  declaringTypeId?: string;
  fingerprint?: string;
  change?: "added" | "changed";
}
export interface Edge {
  id: string;
  from: string;
  to: string;
  label: string;
  evidence: Evidence[];
  confidence: "observed" | "inferred" | "verified";
  generator?: "java";
  relation?: "extends" | "implements" | "injects" | "calls" | "depends";
  change?: "added" | "changed";
}
export interface JavaSourceScope {
  roots: string[];
  parentId?: string;
  /** Group for a generated root; an existing parent keeps its own group. */
  kind?: string;
  features: { id: string; name: string; seeds: string[] }[];
}
export interface JavaConfig extends JavaSourceScope {
  enabled: boolean;
  /** Additional independently navigable modules, resolved in the same source index. */
  scopes?: (JavaSourceScope & {id: string; name: string})[];
}
export interface JavaDiagnostic {
  path: string; line: number; symbol?: string;
  kind: "parse" | "unresolved" | "ambiguous";
  message: string; candidates?: string[];
}
export interface JavaGraphState {
  status: "complete" | "failed";
  configId: string;
  sourceInputId: string;
  parsedFiles: number; reusedFiles: number; resolvedFiles: number;
  diagnostics: JavaDiagnostic[];
  diagnosticCount: number;
  changes: {
    added: { id: string; name: string }[];
    changed: { id: string; name: string }[];
    removed: { id: string; name: string }[];
    addedEdges: Edge[]; changedEdges: Edge[]; removedEdges: Edge[];
  };
}
export interface Journey {
  id: string;
  name: string;
  description: string;
  steps: { moduleId: string; label: string; evidence: Evidence[] }[];
  confidence: "inferred" | "verified";
}
export interface Snapshot {
  schemaVersion: 1;
  id: string;
  generatedAt: string;
  source: {
    kind: "local" | "remote";
    commit: string | null;
    branch: string | null;
    dirty: boolean;
  };
  files: FileEntry[];
  modules: Module[];
  edges: Edge[];
  journeys: Journey[];
  warnings: string[];
  analysis: {
    status: "pending" | "complete" | "stale" | "failed";
    inputId: string;
    updatedAt?: string;
    error?: string;
  };
  java?: JavaGraphState;
}
export type TaskStatus =
  | "todo"
  | "developing"
  | "review"
  | "rework"
  | "passed"
  | "integrated"
  | "integration-review"
  | "integration-passed"
  | "handtest"
  | "done";
export interface Review {
  reviewer: string;
  commit: string;
  report: string;
  passed: boolean;
  untested: string[];
  at: string;
}
export interface Task {
  id: string;
  title: string;
  priority: "P0" | "P1" | "P2";
  status: TaskStatus;
  issue?: string;
  description: string;
  criteria: string[];
  dependsOn: string[];
  files: string[];
  owner?: string;
  developer?: string;
  integrator?: string;
  reviewer?: string;
  branch?: string;
  baseCommit?: string;
  commit?: string;
  integrationCommit?: string;
  reviews: Review[];
  integrationReview?: Review;
  userAcceptance?: { commit: string; source: string; at: string };
  blocked?: string;
  updatedAt: string;
}
export interface Ledger {
  schemaVersion: 1;
  revision: number;
  tasks: Task[];
  events: { at: string; taskId: string; actor: string; action: string }[];
}
export interface Config {
  schemaVersion: 1;
  language: Language;
  tool: Tool;
  mode: "manual" | "automatic";
  models: { A: string; B: string; C: string };
  exclude: string[];
  remote: { enabled: boolean; url: string; branch: string; intervalMs: number };
  analysis: {
    enabled: boolean;
    command: string[];
    minIntervalMs: number;
    maxCallsPerDay: number;
  };
  refresh: { debounceMs: number; reconcileMs: number };
  /** Persistent homepage categories; membership changes presentation, not source hierarchy. */
  moduleGroups?: { id: string; name: string; description?: string; moduleIds: string[] }[];
  java?: JavaConfig;
}
export interface RuntimeState {
  running: boolean;
  paused: boolean;
  lastScan?: string;
  lastRemote?: string;
  error?: string;
  analysisCalls: number;
  analysisDay: string;
  analyzing: boolean;
  changedFiles: string[];
}
export interface DashboardState {
  workspaceId?: string;
  /** Explicit per-source, per-scope requests to arrange a saved canvas once. */
  layoutRequests?: Partial<Record<"local" | "remote", Record<string, string>>>;
  descriptionRevision?: number;
  architectureRevision?: number;
  config: Config;
  local: Snapshot;
  remote: Snapshot | null;
  ledger: Ledger;
  runtime: RuntimeState;
  capabilities: Record<string, unknown>;
}
