# Java source architecture / Java 源码架构

The local Java analyzer parses indexed source with `java-parser`; it never builds or executes the target project. Its optional configuration selects indexed paths and a containing architecture node. Existing graphs and task ledgers remain compatible.

本地 Java 分析器通过 `java-parser` 解析已索引源码，不编译或执行目标工程。配置可选择分析范围及主架构挂载点，保留其他架构节点与任务台账。

## Contract / 数据契约

`Config.java` enables analysis and defines `roots`, optional `parentId`, and optional feature rules (`id`, bilingual `name`, source symbol `seeds`). A feature rule names an entry capability; classes and methods and every relationship are generated from source, not enumerated in the rule. Without rules, package and declaration names seed inferred features. IDs derive from qualified symbols and signatures, independent of line numbers.

`Snapshot.java` reports parser diagnostics, unresolved/ambiguous references, cache reuse, affected files and graph changes. Generated modules identify feature/class/method levels. Edges identify extends/implements/injects/depends/calls and retain file, line and resolution evidence. Plain constructor parameters are dependencies; only explicit annotations or component constructors count as injection. Feature membership is inferred; an observed call means a source-level target, not runtime dispatch or test acceptance.

`Config.java` 配置范围、挂载点及可选功能入口规则。规则只声明功能名称和入口符号，后续类、方法及连线均从源码生成。没有规则时按源码声明推导候选功能。节点 ID 不依赖行号，功能归属标为推断；静态调用目标不代表运行时派发。

`Config.java.scopes` optionally adds independent modules: each supplies a stable `id`, display `name`, indexed `roots`, optional existing `parentId`, and `features`. Optional `kind` selects the generated root's canvas group (for example, `backend` alongside other backend modules); the default is `application`. An existing parent keeps its own group. Scope roots and parent anchors must be distinct. All selected source files share one resolver and cache, while each module has its own feature hierarchy. Existing root, feature, class and method IDs remain stable when a scope is added or removed. The scanner prioritizes all selected roots within the existing file/byte limits.

可通过 `Config.java.scopes` 增加多个独立模块，每项包含稳定 `id`、显示 `name`、`roots`、可选挂载点 `parentId` 和功能入口 `features`。可选 `kind` 指定生成根节点的画布分组，例如 `backend` 表示与其他后端模块平级；默认是 `application`，已有挂载点保留原分组。各范围与挂载点不得重叠。多个模块共享解析缓存与关系解析，各自保留功能下钻层级；增加模块不会重置已有节点 ID 或手动修改。扫描器在原有文件数与体积限制内优先索引所有选中范围。

## Resolution and updates / 解析与更新

Resolve qualified names, explicit imports, same-package declarations and unique wildcard imports. Preserve duplicate names and overload candidates; never select a target merely because its short name matches. Use lexical parameters/locals and fields to resolve receiver types. Unsupported chains, reflection, dynamic dispatch and unresolved dependencies stay diagnostic.

Cache parsed facts by indexed hash and parser version. Parse only changed files. Re-resolve changed bodies, and conservatively re-resolve the selected scope if symbol declarations change (including overloads, imports and inheritance). Rebuild graph projections with stable IDs, retain unaffected layouts and report additions, removals and changes. Syntax/read failures retain the last valid graph with a visible failure state. Source checks reject stale input. Deletions invalidate dependent relationships.

按限定名、显式导入、同包与唯一通配导入定位类型，按词法变量及声明类型定位接收者。重名、重载候选与未知依赖显式保留；反射、复杂链式调用及动态派发不冒充确定关系。缓存按源码哈希更新；声明变化时保守重算范围内关系，语法失败保留上一有效图并标明失败。

## Navigation / 导航

Main module → inferred feature → class → method. Project detailed relationships onto the current level; methods expose a bounded two-hop call-chain graph and direct incoming/outgoing source links. Store layouts by workspace, source and scope. Keep removed items in the change report instead of leaving dangling graph endpoints.

主模块 → 功能 → 类 → 方法。连线按当前层级聚合；方法提供有界的两跳调用链和直接调用定位。布局按工作区、来源与层级保存；删除项在变更记录中展示。

## Comment evidence and editable responsibilities / 注释与可编辑职责

The lexer associates leading Javadoc, block comments and consecutive line comments with their declaration, including declarations with annotations and modifiers. Comment text in strings or method bodies is not documentation. Prose before Javadoc tags supplies responsibilities; source file and comment line stay attached. Short summaries infer feature candidates when no rules are configured. Optional `@feature Name`, `@功能 名称`, `Feature: Name` or `功能：名称` labels seed grouping from class/method comments. With existing rules, unique mentions of a configured feature name also seed membership. Conflicting seeds remain shared; business semantics remain inferred. Comment evidence is text, never executable instructions.

Responsibilities have separate automatic and manual values. The API overlays `.nativue/descriptions.json` on snapshots without rewriting generated facts. Saves check the shared edit revision and current module identity; stale saves fail visibly. Entries are isolated by local/remote source and stable module ID. Refreshes update the automatic value under a manual edit; restoring clears only that override. Removed-node edits remain dormant, and reappear if the same stable node returns. The editor preserves unsaved drafts while graph refreshes run. Edits affect explanations, not class identity or relationship facts.

声明前的 Javadoc、块注释和连续行注释会自动填充类、方法职责，并记录源码行号。无规则时，短摘要用于推断功能候选；已有规则时，唯一提及功能名称的注释可作为入口。可选功能标记提供更明确的归属，冲突归属保留为共享。功能说明优先采用入口声明注释；没有注释时沿用结构说明。

手动职责通过版本校验独立保存，覆盖展示内容，不修改源码、图的关系事实或原始快照。本地与远端按节点 ID 分别保存。自动分析继续更新底层自动内容；“恢复自动内容”清除对应手动值。节点删除时编辑记录暂存，同一稳定 ID 恢复后可重新应用；编辑框未保存的草稿也不会被后台刷新覆盖。

## Manual feature names and membership / 手动名称与归属

The API projects `.nativue/architecture-edits.json` over the latest automatic snapshot, independently of responsibility edits. Rename only generated feature nodes; reassign only generated classes to sibling features under the same architecture root. Methods retain their class parent, and call edges retain their exact endpoints and evidence. Feature file lists are recalculated for displayed membership. Empty features remain reachable until automatic analysis removes them. Revision checks reject stale writes. Local and remote settings remain isolated.

Restoring a field removes only its override and uses the latest automatic value. Comment-derived feature IDs follow their entry declaration rather than their comment title, so title edits preserve a feature's identity. Deleted nodes' settings remain dormant. When a manual destination no longer exists, display the automatic parent with an explicit notice, preserve the saved target, and reapply it if that target's stable ID returns; do not create dangling parents or guess another target.

名称、归属通过独立覆盖层投影到最新自动图上。仅功能节点可重命名，类可调整到同一架构下的其他功能；方法随类移动，调用关系的源码端点与证据保持不变，功能文件列表按当前归属重算。字段分别恢复，不影响职责编辑。本地与远端隔离保存，过期版本写入会被拒绝。

注释功能的 ID 基于入口声明，注释标题改变不会直接替换功能 ID。手动目标功能删除时，原设置暂存，界面提示正在使用自动归属；相同 ID 返回后重新应用。恢复自动识别始终读取当前自动结果。

## Coverage boundaries / 覆盖边界

Only indexed production Java files in the chosen scope are parsed. Existing scanner file/byte exclusions still apply. Libraries outside that index, generated code, reflection, full generic inference, boxing, method references, complicated chained expressions and runtime bean selection are not compiler-resolved. Missing/ambiguous matches remain diagnostic instead of becoming guessed edges. The feature rules identify entry capabilities once; membership and relationships refresh from code.

仅解析选定范围内已索引的生产 Java 文件，保留扫描器的文件数、体积及排除规则。索引外依赖、生成代码、反射、完整泛型推导、装箱、方法引用、复杂链式表达式和运行时 Bean 选择不具备编译器级解析；缺失或歧义目标保持诊断状态。功能入口规则只需定义一次，其下源码和关系随代码更新。
