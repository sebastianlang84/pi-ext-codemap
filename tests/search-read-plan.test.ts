import assert from "node:assert/strict";
import test from "node:test";

const { explainSearchContextReadPlan, mergeSearchContextReadPlan } = await import("../src/core/navigation-read-plan.ts");

test("search+context read plan preserves visible search hits within the read budget", () => {
  assert.deepEqual(
    mergeSearchContextReadPlan(
      ["src/pi-extension/tools.ts", "test/pi-extension/tools.test.ts", "src/pi-extension/tag-catalog.ts", "src/pi-extension/formatters.ts"],
      ["src/pi-extension/tools.ts", "src/core/index.ts", "src/pi-extension/formatters.ts", "test/pi-extension/tools.test.ts", "src/pi-extension/index.ts"],
      5,
    ),
    ["src/pi-extension/tools.ts", "test/pi-extension/tools.test.ts", "src/pi-extension/tag-catalog.ts", "src/pi-extension/formatters.ts", "src/core/index.ts"],
  );
});

test("search+context read plan diagnostics explain budgeted selections", () => {
  const diagnostics = explainSearchContextReadPlan(
    ["src/pi-extension/tools.ts", "test/pi-extension/tools.test.ts", "src/pi-extension/tag-catalog.ts", "src/pi-extension/formatters.ts"],
    [
      { path: "src/pi-extension/tools.ts", reasons: [{ kind: "target" }] },
      { path: "src/core/index.ts", reasons: [{ kind: "import" }] },
      { path: "src/pi-extension/formatters.ts", reasons: [{ kind: "import" }] },
      { path: "test/pi-extension/tools.test.ts", reasons: [{ kind: "reverse_test" }] },
      { path: "src/pi-extension/index.ts", reasons: [{ kind: "import" }] },
    ],
    3,
  );

  assert.deepEqual(diagnostics.selected, ["src/pi-extension/tools.ts", "test/pi-extension/tools.test.ts", "src/core/index.ts"]);
  assert.equal(diagnostics.budget.available, 6);
  assert.equal(diagnostics.budget.dropped, 3);
  assert.deepEqual(
    diagnostics.decisions.slice(0, 4).map((item) => [item.path, item.bucket, item.selected, item.rank]),
    [
      ["src/pi-extension/tools.ts", "first_search", true, 1],
      ["test/pi-extension/tools.test.ts", "context_backed_search", true, 2],
      ["src/core/index.ts", "direct_import", true, 3],
      ["src/pi-extension/tag-catalog.ts", "active_search", false, undefined],
    ],
  );
});

test("search+context read plan defers archived docs behind active search and context paths", () => {
  assert.deepEqual(
    mergeSearchContextReadPlan(
      [
        "src/pi-extension/audit.ts",
        "test/pi-extension/audit.test.ts",
        "docs/archive/plans/memory-scope-simplification.md",
        "src/core/policy.ts",
        "src/pi-extension/retrieval.ts",
      ],
      [
        { path: "src/pi-extension/audit.ts", reasons: [{ kind: "target" }] },
        { path: "src/core/index.ts", reasons: [{ kind: "import" }] },
        { path: "test/pi-extension/audit.test.ts", reasons: [{ kind: "reverse_test" }] },
        { path: "test/pi-extension/commands.test.ts", reasons: [{ kind: "sibling_test" }] },
      ],
      5,
    ),
    [
      "src/pi-extension/audit.ts",
      "test/pi-extension/audit.test.ts",
      "src/core/policy.ts",
      "src/pi-extension/retrieval.ts",
      "src/core/index.ts",
    ],
  );
});

test("search+context read plan promotes context-related tests ahead of lower search hits", () => {
  assert.deepEqual(
    mergeSearchContextReadPlan(
      [
        "apps/web/src/lib/series-workbench-chart.ts",
        "apps/web/src/components/series-workbench.tsx",
        "apps/web/src/lib/use-series-workbench-session.ts",
        "docs/plans/20260502-newsletter-macro-data-integration.md",
      ],
      [
        { path: "apps/web/src/lib/series-workbench-chart.ts", reasons: [{ kind: "target" }] },
        { path: "apps/web/src/lib/formatters.ts", reasons: [{ kind: "import" }] },
        { path: "apps/web/src/lib/series-analysis.ts", reasons: [{ kind: "import" }] },
        { path: "apps/web/src/lib/__tests__/series-workbench-chart.test.ts", reasons: [{ kind: "sibling_test" }, { kind: "reverse_test" }] },
      ],
      5,
    ),
    [
      "apps/web/src/lib/series-workbench-chart.ts",
      "apps/web/src/lib/__tests__/series-workbench-chart.test.ts",
      "apps/web/src/components/series-workbench.tsx",
      "apps/web/src/lib/use-series-workbench-session.ts",
      "docs/plans/20260502-newsletter-macro-data-integration.md",
    ],
  );
});

test("search+context read plan keeps the first direct import before lower search hits", () => {
  assert.deepEqual(
    mergeSearchContextReadPlan(
      [
        "apps/web/src/lib/series-workbench-backtest-target.ts",
        "apps/web/src/lib/series-workbench-backtest.ts",
        "apps/web/src/components/series-workbench.tsx",
        "apps/web/src/lib/__tests__/series-workbench-backtest-target.test.ts",
        "apps/web/src/lib/__tests__/series-workbench-backtest.test.ts",
      ],
      [
        { path: "apps/web/src/lib/series-workbench-backtest-target.ts", reasons: [{ kind: "target" }] },
        { path: "apps/web/src/lib/series-analysis.ts", reasons: [{ kind: "import" }] },
        { path: "apps/web/src/lib/series-workbench-engine.ts", reasons: [{ kind: "import" }] },
        { path: "apps/web/src/lib/__tests__/series-workbench-backtest-target.test.ts", reasons: [{ kind: "sibling_test" }, { kind: "reverse_test" }] },
        { path: "apps/web/src/lib/series-workbench-backtest.ts", reasons: [{ kind: "reverse_import" }] },
      ],
      5,
    ),
    [
      "apps/web/src/lib/series-workbench-backtest-target.ts",
      "apps/web/src/lib/series-workbench-backtest.ts",
      "apps/web/src/lib/__tests__/series-workbench-backtest-target.test.ts",
      "apps/web/src/lib/series-analysis.ts",
      "apps/web/src/components/series-workbench.tsx",
    ],
  );
});

test("search+context read plan does not let direct imports displace config hits", () => {
  assert.deepEqual(
    mergeSearchContextReadPlan(
      ["api/app.py", "docker-compose.webapp.yml"],
      [
        { path: "api/app.py", reasons: [{ kind: "target" }] },
        { path: "docker-compose.webapp.yml", reasons: [{ kind: "near_config" }] },
        { path: "api/settings.py", reasons: [{ kind: "import" }] },
      ],
      2,
    ),
    ["api/app.py", "docker-compose.webapp.yml"],
  );
});

test("search+context read plan keeps imported-neighbor tests before lower doc hits", () => {
  assert.deepEqual(
    mergeSearchContextReadPlan(
      [
        "src/pi-extension/turn-intake.ts",
        "src/pi-extension/retrieval.ts",
        "docs/user/usage.md",
        "CHANGELOG.md",
        "test/pi-extension/turn-intake.test.ts",
      ],
      [
        { path: "src/pi-extension/turn-intake.ts", reasons: [{ kind: "target" }] },
        { path: "src/core/index.ts", reasons: [{ kind: "import" }] },
        { path: "src/pi-extension/retrieval.ts", reasons: [{ kind: "import" }] },
        { path: "test/pi-extension/turn-intake.test.ts", reasons: [{ kind: "sibling_test" }, { kind: "reverse_import" }, { kind: "reverse_test" }] },
        { path: "test/pi-extension/retrieval.test.ts", reasons: [{ kind: "sibling_test", targetPath: "src/pi-extension/retrieval.ts" }] },
      ],
      5,
    ),
    [
      "src/pi-extension/turn-intake.ts",
      "test/pi-extension/retrieval.test.ts",
      "test/pi-extension/turn-intake.test.ts",
      "src/pi-extension/retrieval.ts",
      "docs/user/usage.md",
    ],
  );
});

test("search+context read plan does not promote sibling tests for non-search import targets", () => {
  assert.deepEqual(
    mergeSearchContextReadPlan(
      ["src/pi-extension/retrieval.ts", "docs/adr/005-simplified-agent-facing-scopes.md", "docs/adr/006-normal-and-advanced-tool-surface.md"],
      [
        { path: "src/pi-extension/retrieval.ts", reasons: [{ kind: "target" }] },
        { path: "src/core/identity-policy.ts", reasons: [{ kind: "import" }] },
        { path: "test/core/identity-policy.test.ts", reasons: [{ kind: "sibling_test", targetPath: "src/core/identity-policy.ts" }] },
        { path: "docs/adr/005-simplified-agent-facing-scopes.md", reasons: [{ kind: "related_doc" }] },
        { path: "docs/adr/006-normal-and-advanced-tool-surface.md", reasons: [{ kind: "related_doc" }] },
      ],
      3,
    ),
    ["src/pi-extension/retrieval.ts", "docs/adr/005-simplified-agent-facing-scopes.md", "docs/adr/006-normal-and-advanced-tool-surface.md"],
  );
});
