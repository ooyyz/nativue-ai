import { parse, type CstNode, type IToken } from "java-parser";
import { createHash } from "node:crypto";
export const PARSER_VERSION = "java-parser-3.0.1/facts-7";
export interface SourceDoc {
  summary: string;
  line: number;
  feature?: string;
}
export interface Variable {
  name: string;
  type: string;
  start: number;
  end: number;
  scopeStart: number;
  line?: number;
  injected?: boolean;
}
export interface Call {
  name: string;
  receiver: string;
  args: string[][];
  line: number;
  offset: number;
  chained: boolean;
}
export interface MethodFact {
  doc?: SourceDoc;
  key: string;
  name: string;
  params: Variable[];
  returns: string;
  line: number;
  hash: string;
  variables: Variable[];
  calls: Call[];
  constructor: boolean;
  injected: boolean;
  varargs: boolean;
}
export interface TypeFact {
  doc?: SourceDoc;
  name: string;
  qualified: string;
  declaringType?: string;
  kind: string;
  component: boolean;
  path: string;
  package: string;
  imports: string[];
  extends: string[];
  implements: string[];
  referenceLines: Record<string, number>;
  line: number;
  hash: string;
  fields: Variable[];
  methods: MethodFact[];
}
export interface JavaFileFacts {
  path: string;
  hash: string;
  types: TypeFact[];
}
type Node = CstNode;
const typeNodes = new Set([
  "normalClassDeclaration",
  "normalInterfaceDeclaration",
  "enumDeclaration",
  "recordDeclaration",
  "annotationInterfaceDeclaration",
]);
const methodNodes = new Set([
  "methodDeclaration",
  "interfaceMethodDeclaration",
  "constructorDeclaration",
  "compactConstructorDeclaration",
]);
const scopes = new Set([
  "block",
  "constructorBody",
  "basicForStatement",
  "enhancedForStatement",
  "lambdaExpression",
  "catchClause",
]);
export const digest = (s: string) =>
  createHash("sha256").update(s).digest("hex");
const children = (n: Node): Node[] =>
  Object.values(n.children)
    .flat()
    .filter((x) => "children" in x) as Node[];
function nodes(n: Node, name: string, stop: Set<string> = new Set()): Node[] {
  const found: Node[] = [];
  function visit(x: Node) {
    if (stop.has(x.name) && x !== n) return;
    if (x.name === name) found.push(x);
    for (const c of children(x)) visit(c);
  }
  visit(n);
  return found;
}
export function tokens(n: Node): IToken[] {
  const out: IToken[] = [];
  function visit(x: Node) {
    for (const a of Object.values(x.children))
      for (const c of a) {
        if ("children" in c) visit(c as Node);
        else out.push(c as IToken);
      }
  }
  visit(n);
  return out.sort((a, b) => a.startOffset - b.startOffset);
}
const image = (n?: Node) =>
  n
    ? tokens(n)
        .map((t) => t.image)
        .join("")
    : "";
const first = (n: Node, name: string) => nodes(n, name)[0];
const isIdentifier = (t: IToken) =>
  t.tokenType.name === "Identifier" ||
  t.tokenType.CATEGORIES?.some((c) => c.name === "Identifier");
const identifier = (n?: Node) =>
  n
    ? tokens(n).find(isIdentifier)?.image || ""
    : "";
function typeName(n?: Node): string {
  if (!n) return "?";
  let depth = 0,
    result = "";
  for (const t of tokens(n)) {
    if (t.image === "<") depth++;
    else if (t.image === ">") depth--;
    else if (!depth) result += t.image;
  }
  return result.replace(/\.\.\.$/, "[]");
}
const annotations = (n: Node) =>
  nodes(n, "annotation").map((a) =>
    image(first(a, "typeName")).split(".").pop(),
  );
const injected = (n: Node) =>
  annotations(n).some((a) =>
    ["Autowired", "Inject", "Resource"].includes(a || ""),
  );
function declarations(
  n: Node,
  start: number,
  end: number,
  scopeStart: number,
): Variable[] {
  const typ = typeName(
    first(n, "unannType") ||
      first(n, "localVariableType") ||
      first(n, "catchType"),
  );
  const list = [
    "fieldDeclaration",
    "constantDeclaration",
    "localVariableDeclaration",
  ].includes(n.name)
    ? first(n, "variableDeclaratorList")
    : undefined;
  const ids = list
    ? (((list.children.variableDeclarator || []) as Node[])
        .map((d) => first(d, "variableDeclaratorId"))
        .filter(Boolean) as Node[])
    : nodes(n, "variableDeclaratorId").slice(0, 1);
  return ids.map((d) => ({
    name: identifier(d),
    type: typ + (image(d).includes("[") ? "[]" : ""),
    start,
    end,
    scopeStart,
    line: n.location.startLine,
  }));
}
function argumentsOf(n: Node): string[][] {
  const list = n.children.argumentList?.[0] as Node | undefined;
  return ((list?.children.expression || []) as Node[]).map((e) =>
    tokens(e).map((t) => t.image),
  );
}
// Only lexer-recognized comments immediately preceding a declaration belong to it.
function declarationDoc(source: string, comments: IToken[], offset: number): SourceDoc | undefined {
  const adjacent: IToken[] = [];
  for (const c of [...comments].reverse()) {
    if (c.endOffset >= offset) continue;
    if (source.slice(c.endOffset + 1, offset).trim()) break;
    const lineStart = source.lastIndexOf("\n", c.startOffset - 1) + 1;
    if (source.slice(lineStart, c.startOffset).trim()) break;
    adjacent.unshift(c);
    offset = c.startOffset;
    if (!c.image.startsWith("//")) break;
  }
  if (!adjacent.length) return;
  const lines = adjacent.flatMap(c => c.image.replace(/^\/\*\*?/, "").replace(/\*\/$/, "").split(/\r?\n/))
    .map(l => l.replace(/^\s*(?:\/\/|\*)?\s?/, "").trim());
  const feature = lines.map(l => l.match(/^(?:@feature|@功能)\s+(.+)$/i)?.[1] ||
    l.match(/^(?:功能|所属功能|feature)\s*[:：]\s*(.+)$/i)?.[1]).find(Boolean)?.trim().slice(0, 80);
  const prose: string[] = [];
  for (const line of lines) {
    if (/^@(?:feature|功能)\s/i.test(line) || /^(?:功能|所属功能|feature)\s*[:：]/i.test(line)) continue;
    if (/^@/.test(line)) break;
    prose.push(line);
  }
  const summary = prose.join("\n").replace(/\{@(?:link|linkplain|code|literal)\s+([^}]+)\}/g, "$1")
    .replace(/<\/?(?:p|br|li|ul|ol|pre|div)\b[^>]*>/gi, "\n").replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, 4000);
  if (!summary && !feature) return;
  return { summary, line: adjacent[0].startLine!, ...(feature ? {feature} : {}) };
}
function methodFact(n: Node, source: string, ownerName: string): MethodFact {
  const decl =
    first(n, "methodDeclarator") || first(n, "constructorDeclarator") || n;
  const constructor =
    n.name.includes("Constructor") || n.name === "constructorDeclaration";
  const name = constructor
    ? "<init>"
    : identifier(
        (decl.children.Identifier?.[0] ? decl : first(decl, "methodName")) ||
          decl,
      );
  const params = nodes(decl, "formalParameter")
    .map(
      (p) =>
        declarations(
          p,
          n.location.startOffset,
          n.location.endOffset,
          n.location.startOffset,
        )[0],
    )
    .filter(Boolean);
  // Varargs use a separate grammar production.
  for (const p of nodes(decl, "variableArityParameter")) {
    const name = (p.children.Identifier?.[0] as IToken | undefined)?.image;
    if (name && !params.some((v) => v.name === name))
      params.push({
        name,
        type: typeName(first(p, "unannType")) + "[]",
        start: n.location.startOffset,
        end: n.location.endOffset,
        scopeStart: n.location.startOffset,
      });
  }
  const variables: Variable[] = [...params];
  const calls: Call[] = [];
  function visit(x: Node, parents: Node[]) {
    if ((typeNodes.has(x.name) || x.name === "classBody") && x !== n) return;
    const scope = [...parents].reverse().find((p) => scopes.has(p.name)) || n;
    if (x.name === "localVariableDeclaration") {
      const ds = declarations(
        x,
        x.location.startOffset,
        scope.location.endOffset,
        scope.location.startOffset,
      );
      for (const d of ds) {
        if (d.type === "var") {
          const init = first(x, "variableInitializer");
          const ts = init ? tokens(init).map((t) => t.image) : [];
          d.type =
            ts[0] === "new" ? ts.slice(1, ts.indexOf("(")).join("") : "?";
        }
        variables.push(d);
      }
    }
    if (x.name === "lambdaExpression") {
      const p = first(x, "lambdaParameters")!;
      const typed = nodes(p, "regularLambdaParameter");
      if (typed.length)
        for (const v of typed)
          variables.push(
            ...declarations(
              v,
              x.location.startOffset,
              x.location.endOffset,
              x.location.startOffset,
            ),
          );
      else
        for (const t of tokens(p).filter(isIdentifier))
          variables.push({
            name: t.image,
            type: "?",
            start: x.location.startOffset,
            end: x.location.endOffset,
            scopeStart: x.location.startOffset,
          });
    }
    if (x.name === "catchFormalParameter" || x.name === "enhancedForStatement")
      variables.push(
        ...declarations(
          x,
          x.location.startOffset,
          x.location.endOffset,
          x.location.startOffset,
        ),
      );
    if (x.name === "primary") {
      const suffixes = (x.children.primarySuffix || []) as Node[];
      const invocations = suffixes.flatMap(
        (s) => (s.children.methodInvocationSuffix || []) as Node[],
      );
      const ts = tokens(x);
      for (let i = 0; i < invocations.length; i++) {
        const inv = invocations[i],
          prefix = ts.filter((t) => t.endOffset < inv.location.startOffset);
        const parts = prefix.map((t) => t.image),
          method = parts.at(-1) || "";
        const receiver = parts.slice(0, -1).join("").replace(/\.$/, "");
        calls.push({
          name: method,
          receiver,
          args: argumentsOf(inv),
          line: prefix.at(-1)?.startLine || inv.location.startLine,
          offset: prefix.at(-1)?.startOffset || inv.location.startOffset,
          chained:
            i > 0 || parts.some((p) => ["(", ")", "new", "[", "]"].includes(p)),
        });
      }
    }
    for (const c of children(x)) visit(c, [...parents, x]);
  }
  visit(n, []);
  const returns = constructor ? ownerName : typeName(first(n, "result"));
  return {
    key: name + "(" + params.map((p) => p.type).join(",") + ")",
    name,
    params,
    returns,
    line: n.location.startLine,
    hash: digest(
      source.slice(n.location.startOffset, n.location.endOffset + 1),
    ),
    variables,
    calls,
    constructor,
    injected: children(n)
      .filter((c) => c.name.endsWith("Modifier"))
      .some(injected),
    varargs: nodes(decl, "variableArityParameter").length > 0,
  };
}
export function parseJava(
  path: string,
  hash: string,
  source: string,
): JavaFileFacts {
  const tree = parse(source),
    packageTokens = first(tree, "packageDeclaration")
      ? tokens(first(tree, "packageDeclaration")!)
      : [];
  const pkg = packageTokens
    .slice(packageTokens.findIndex((t) => t.image === "package") + 1)
    .map((t) => t.image)
    .join("")
    .replace(/;$/, "");
  const imports = nodes(tree, "importDeclaration").map((n) =>
    image(n)
      .replace(/^import/, "")
      .replace(/;$/, "")
      .replace(/^static/, "static "),
  );
  const types: TypeFact[] = [];
  function visit(n: Node, outer: string[], wrapper?: Node) {
    if (typeNodes.has(n.name)) {
      const name = identifier(
        (n.children.typeIdentifier?.[0] as Node) ||
          (n.children.typeName?.[0] as Node),
      );
      if (!name) return;
      const qualified = [pkg, ...outer, name].filter(Boolean).join(".");
      const fields: Variable[] = [],
        methods: MethodFact[] = [];
      function members(x: Node, parent?: Node) {
        if (typeNodes.has(x.name) && x !== n) {
          visit(x, [...outer, name], parent);
          return;
        }
        if (methodNodes.has(x.name)) {
          methods.push({...methodFact(x, source, name), doc: declarationDoc(source, tree.comments || [], x.location.startOffset)});
          return;
        }
        if (["fieldDeclaration", "constantDeclaration"].includes(x.name)) {
          fields.push(
            ...declarations(
              x,
              x.location.startOffset,
              n.location.endOffset,
              n.location.startOffset,
            ).map((v) => ({ ...v, injected: injected(x) })),
          );
          return;
        }
        for (const c of children(x)) members(c, x);
      }
      members(n);
      const ext = (n.children.classExtends ||
        n.children.interfaceExtends ||
        []) as Node[];
      const impl = (n.children.classImplements ||
        n.children.recordImplements ||
        []) as Node[];
      function refs(a: Node[]) {
        return a.flatMap((x) => {
          const list = nodes(x, "interfaceType");
          return list.length
            ? list.map(typeName)
            : nodes(x, "classType").slice(0, 1).map(typeName);
        });
      }
      const referenceLines: Record<string, number> = {};
      for (const n of [...ext, ...impl])
        for (const ref of [
          ...nodes(n, "classType"),
          ...nodes(n, "interfaceType"),
        ])
          referenceLines[typeName(ref)] = ref.location.startLine;
      const component =
        !!wrapper &&
        children(wrapper)
          .filter((c) => c.name.endsWith("Modifier"))
          .some((c) =>
            annotations(c).some((a) =>
              [
                "Component",
                "Service",
                "Repository",
                "Controller",
                "RestController",
                "Configuration",
                "Named",
                "Singleton",
              ].includes(a || ""),
            ),
          );
      types.push({
        name,
        qualified,
        declaringType: outer.length ? [pkg, ...outer].filter(Boolean).join(".") : undefined,
        component,
        doc: declarationDoc(source, tree.comments || [], (wrapper || n).location.startOffset),
        kind: n.name.includes("Interface")
          ? "interface"
          : n.name.includes("enum")
            ? "enum"
            : n.name.includes("record")
              ? "record"
              : "class",
        path,
        package: pkg,
        imports,
        extends: refs(ext),
        implements: refs(impl),
        referenceLines,
        line: n.location.startLine,
        hash: digest(
          source.slice(n.location.startOffset, n.location.endOffset + 1),
        ),
        fields,
        methods,
      });
      return;
    }
    for (const c of children(n)) visit(c, outer, n);
  }
  visit(tree, []);
  return { path, hash, types };
}
