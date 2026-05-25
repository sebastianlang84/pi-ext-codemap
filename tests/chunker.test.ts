import assert from "node:assert/strict";
import test from "node:test";

import { chunkText } from "../src/core/chunker.ts";

test("markdown chunking keeps fenced code blocks intact", () => {
  const markdown = [
    "   ~~~ts",
    ...Array.from({ length: 9 }, (_, index) => `const line${index} = ${index};`),
    "~~~ not a closing fence",
    "## not a heading inside code",
    "export const after = true;",
    "   ~~~",
    "## Next section",
    "after the fence",
  ].join("\n");

  const chunks = chunkText(markdown, "markdown");

  assert.ok(chunks.length >= 2);
  const fenceChunk = chunks.find((chunk) => chunk.text.includes("~~~ not a closing fence"));
  assert.equal(fenceChunk?.startLine, 1);
  assert.equal(fenceChunk?.endLine, 14);
  assert.match(fenceChunk?.text ?? "", /## not a heading inside code/);
  assert.match(fenceChunk?.text ?? "", /^\s{3}~~~$/m);
});

test("typescript chunking keeps top-level functions and classes as stable chunks", () => {
  const source = [
    "export function longWorkflow() {",
    "  const closeBrace = '}';",
    "  const openBrace = `{`;",
    "  // } in a comment must not close the chunk",
    "  /* { in a block comment must not keep it open */",
    "  const closeRegex = /}/;",
    "  if (!closeRegex) throw /}/;",
    "  const regexFactory = () => /}/;",
    ...Array.from({ length: 83 }, (_, index) => `  const step${index} = ${index};`),
    "  return step82 + closeBrace.length + openBrace.length + closeRegex.source.length;",
    "}",
    "",
    "export class Worker {",
    "  run() { return true; }",
    "}",
  ].join("\n");

  const chunks = chunkText(source, "typescript");
  const workflow = chunks.find((chunk) => chunk.text.includes("longWorkflow"));
  const worker = chunks.find((chunk) => chunk.text.includes("class Worker"));

  assert.equal(workflow?.kind, "function");
  assert.equal(workflow?.startLine, 1);
  assert.equal(workflow?.endLine, 93);
  assert.match(workflow?.text ?? "", /step82/);
  assert.equal(worker?.kind, "class");
  assert.equal(worker?.startLine, 95);
  assert.equal(worker?.endLine, 97);
});

test("typescript chunking does not treat callback expressions as declarations", () => {
  const chunks = chunkText("const selected = items.find((item) => item.ok);\n", "typescript");

  assert.equal(chunks[0]?.kind, "text");
});

test("typescript chunking keeps multiline signatures with default objects stable", () => {
  const source = [
    "export function withDefaults<T extends { id: string }>(",
    "  options = {",
    "    nested: true,",
    "  },",
    "): { ok: boolean } {",
    "  const pattern = /}/;",
    "  return { ok: pattern.test(String(options)) };",
    "}",
  ].join("\n");

  const chunks = chunkText(source, "typescript");
  const defaults = chunks.find((chunk) => chunk.text.includes("withDefaults"));

  assert.equal(defaults?.kind, "function");
  assert.equal(defaults?.startLine, 1);
  assert.equal(defaults?.endLine, 8);
});

test("python chunking keeps functions and classes stable for scanner language", () => {
  const source = [
    "class DeliveryClient:",
    "    def send(self):",
    "        return True",
    "",
    "def run_experiment():",
    ...Array.from({ length: 90 }, (_, index) => `    step_${index} = ${index}`),
    "    return step_89",
  ].join("\n");

  const chunks = chunkText(source, "py");
  const delivery = chunks.find((chunk) => chunk.text.includes("DeliveryClient"));
  const experiment = chunks.find((chunk) => chunk.text.includes("run_experiment"));

  assert.equal(delivery?.kind, "class");
  assert.equal(delivery?.startLine, 1);
  assert.equal(delivery?.endLine, 3);
  assert.equal(experiment?.kind, "function");
  assert.equal(experiment?.startLine, 5);
  assert.equal(experiment?.endLine, 96);
});

test("typescript chunking recognizes anonymous default exports", () => {
  const source = [
    "export default function() {",
    ...Array.from({ length: 90 }, (_, index) => `  const defaultStep${index} = ${index};`),
    "}",
    "",
    "export default class {",
    "  run() { return /}/.test('}'); }",
    "}",
    "",
    "export default () => true",
    "",
    "export const unary = x => x",
    "",
    "export default () => {",
    "  return true;",
    "}",
    "",
    "export const typed: Handler = value => value",
    "",
    "export const mapper: (x: Input) => Output = value => value",
    "",
    "export const identity = <T>(value: T) => value",
    "",
    "export const multiline: Handler = value =>",
    "  transform(value)",
  ].join("\n");

  const chunks = chunkText(source, "typescript");
  const defaultFunction = chunks.find((chunk) => chunk.text.includes("defaultStep89"));
  const defaultClass = chunks.find((chunk) => chunk.text.includes("export default class"));
  const defaultArrow = chunks.find((chunk) => chunk.text.includes("return true"));
  const expressionArrow = chunks.find((chunk) => chunk.text.includes("export default () => true"));
  const unaryArrow = chunks.find((chunk) => chunk.text.includes("export const unary"));
  const typedArrow = chunks.find((chunk) => chunk.text.includes("export const typed"));
  const functionTypedArrow = chunks.find((chunk) => chunk.text.includes("export const mapper"));
  const genericArrow = chunks.find((chunk) => chunk.text.includes("export const identity"));
  const multilineArrow = chunks.find((chunk) => chunk.text.includes("export const multiline"));

  assert.equal(defaultFunction?.kind, "function");
  assert.equal(defaultFunction?.startLine, 1);
  assert.equal(defaultFunction?.endLine, 92);
  assert.equal(defaultClass?.kind, "class");
  assert.equal(defaultClass?.startLine, 94);
  assert.equal(defaultClass?.endLine, 96);
  assert.equal(defaultArrow?.kind, "function");
  assert.equal(defaultArrow?.startLine, 102);
  assert.equal(defaultArrow?.endLine, 104);
  assert.equal(expressionArrow?.kind, "function");
  assert.equal(expressionArrow?.startLine, 98);
  assert.equal(expressionArrow?.endLine, 98);
  assert.equal(unaryArrow?.kind, "function");
  assert.equal(unaryArrow?.startLine, 100);
  assert.equal(unaryArrow?.endLine, 100);
  assert.equal(typedArrow?.kind, "function");
  assert.equal(typedArrow?.startLine, 106);
  assert.equal(typedArrow?.endLine, 106);
  assert.equal(functionTypedArrow?.kind, "function");
  assert.equal(functionTypedArrow?.startLine, 108);
  assert.equal(functionTypedArrow?.endLine, 108);
  assert.equal(genericArrow?.kind, "function");
  assert.equal(genericArrow?.startLine, 110);
  assert.equal(genericArrow?.endLine, 110);
  assert.equal(multilineArrow?.kind, "function");
  assert.equal(multilineArrow?.startLine, 112);
  assert.equal(multilineArrow?.endLine, 113);
});
