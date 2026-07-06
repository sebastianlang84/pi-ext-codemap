#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { codeMapOperationMetadata } from "../src/core/operation-metadata.ts";

export type TokenInjectionFieldName = "description" | "parameters" | "promptSnippet" | "promptGuidelines";

export interface TokenInjectionToolRegistration {
  name: string;
  description?: string;
  parameters?: unknown;
  promptSnippet?: string;
  promptGuidelines?: string[];
}

export interface TokenInjectionFieldReport {
  characters: number;
  tokens: number;
}

export interface TokenInjectionToolReport {
  name: string;
  fields: Record<TokenInjectionFieldName, TokenInjectionFieldReport>;
  total: TokenInjectionFieldReport;
}

export interface TokenInjectionReport {
  generatedAt: string;
  estimator: "chars/4-ceil";
  fields: TokenInjectionFieldName[];
  tools: TokenInjectionToolReport[];
  totals: TokenInjectionFieldReport;
}

export interface TokenInjectionBudgets {
  maxTokensPerTool: number;
  maxTotalTokens: number;
}

export interface TokenInjectionBudgetIssue {
  label: string;
  metric: "toolTokens" | "totalTokens";
  expected: string;
  actual: number;
}

export interface TokenInjectionGate {
  passed: boolean;
  budgets: TokenInjectionBudgets;
  issues: TokenInjectionBudgetIssue[];
}

const fieldNames: TokenInjectionFieldName[] = ["description", "parameters", "promptSnippet", "promptGuidelines"];

// These are a guard against unbounded growth of the always-injected tool surface, not a hard
// minimization target — clarity that measurably improves tool routing is worth the tokens. Raised
// 2026-07 from 190/700 to give codemap_search / codemap_context room for explicit search-first and
// wrong-anchor guidance (the behavioral signals the navigation benchmark showed matter). Set at the
// measured footprint plus ~12% headroom; whether the richer wording pays off is settled by the
// routing eval (experiments/agent-routing.episodes.md) — trim back if it does not.
export const defaultTokenInjectionBudgets: TokenInjectionBudgets = {
  maxTokensPerTool: 300,
  maxTotalTokens: 900,
};

export function estimateTokenInjectionTokens(text: string): number {
  return text.length === 0 ? 0 : Math.ceil(text.length / 4);
}

export function buildTokenInjectionReport(tools: TokenInjectionToolRegistration[], generatedAt = new Date().toISOString()): TokenInjectionReport {
  const toolReports = tools.map((tool) => {
    const fields = {
      description: fieldReport(tool.description ?? ""),
      parameters: fieldReport(JSON.stringify(tool.parameters ?? {}) ?? "{}"),
      promptSnippet: fieldReport(tool.promptSnippet ?? ""),
      promptGuidelines: fieldReport((tool.promptGuidelines ?? []).join("\n")),
    } satisfies Record<TokenInjectionFieldName, TokenInjectionFieldReport>;
    const total = sumFields(Object.values(fields));
    return { name: tool.name, fields, total };
  });
  return {
    generatedAt,
    estimator: "chars/4-ceil",
    fields: fieldNames,
    tools: toolReports,
    totals: sumFields(toolReports.map((tool) => tool.total)),
  };
}

export function buildCodeMapTokenInjectionReport(generatedAt?: string): TokenInjectionReport {
  return buildTokenInjectionReport(
    codeMapOperationMetadata.map((operation) => ({
      name: operation.toolName,
      description: operation.description,
      parameters: operation.parameters,
      promptSnippet: operation.promptSnippet,
      promptGuidelines: operation.promptGuidelines,
    })),
    generatedAt,
  );
}

export function evaluateTokenInjectionBudget(report: TokenInjectionReport, budgets: TokenInjectionBudgets = defaultTokenInjectionBudgets): TokenInjectionGate {
  const issues: TokenInjectionBudgetIssue[] = [];
  for (const tool of report.tools) {
    if (tool.total.tokens > budgets.maxTokensPerTool) {
      issues.push({
        label: tool.name,
        metric: "toolTokens",
        expected: `<= ${budgets.maxTokensPerTool}`,
        actual: tool.total.tokens,
      });
    }
  }
  if (report.totals.tokens > budgets.maxTotalTokens) {
    issues.push({
      label: "all CodeMap tools",
      metric: "totalTokens",
      expected: `<= ${budgets.maxTotalTokens}`,
      actual: report.totals.tokens,
    });
  }
  return { passed: issues.length === 0, budgets, issues };
}

export function formatTokenInjectionIssues(issues: TokenInjectionBudgetIssue[]): string {
  if (issues.length === 0) return "";
  return issues.map((issue) => `${issue.label} ${issue.metric} ${issue.actual} exceeds ${issue.expected}`).join("\n");
}

export function formatTokenInjectionBudgetFailure(report: TokenInjectionReport, issues: TokenInjectionBudgetIssue[]): string {
  const toolRows = report.tools.map((tool) => {
    const fields = fieldNames.map((name) => `${name}=${tool.fields[name].tokens}`).join(", ");
    return `- ${tool.name}: ${tool.total.tokens} tokens (${fields})`;
  });
  return [formatTokenInjectionIssues(issues), "Token injection report:", ...toolRows, `- total: ${report.totals.tokens} tokens`].filter(Boolean).join("\n");
}

function fieldReport(text: string): TokenInjectionFieldReport {
  return { characters: text.length, tokens: estimateTokenInjectionTokens(text) };
}

function sumFields(fields: TokenInjectionFieldReport[]): TokenInjectionFieldReport {
  return {
    characters: fields.reduce((sum, field) => sum + field.characters, 0),
    tokens: fields.reduce((sum, field) => sum + field.tokens, 0),
  };
}

function parseCliArgs(args: string[]): { budgets: TokenInjectionBudgets; gateEnabled: boolean } {
  const budgets = { ...defaultTokenInjectionBudgets };
  let gateEnabled = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const [name, inlineValue] = arg.split("=", 2);
    const value = inlineValue ?? args[i + 1];
    if (arg === "--budget-gate") {
      gateEnabled = true;
    } else if (name === "--max-tool-tokens") {
      budgets.maxTokensPerTool = parsePositiveInteger(name, value);
      gateEnabled = true;
      if (inlineValue === undefined) i++;
    } else if (name === "--max-total-tokens") {
      budgets.maxTotalTokens = parsePositiveInteger(name, value);
      gateEnabled = true;
      if (inlineValue === undefined) i++;
    } else if (arg === "--help") {
      console.log("Usage: check-token-injection.ts [--budget-gate] [--max-tool-tokens N] [--max-total-tokens N]");
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  return { budgets, gateEnabled };
}

function parsePositiveInteger(name: string, value: string | undefined): number {
  if (value === undefined || value.trim() === "") throw new Error(`${name} requires a value`);
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

function runCli(): void {
  const parsed = parseCliArgs(process.argv.slice(2));
  const report = buildCodeMapTokenInjectionReport();
  const gate = evaluateTokenInjectionBudget(report, parsed.budgets);
  console.log(JSON.stringify({ ...report, gate }, null, 2));
  if (parsed.gateEnabled && !gate.passed) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    runCli();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}
