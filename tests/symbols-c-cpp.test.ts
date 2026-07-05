import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { useIsolatedHome } from "./helpers/repo-fixture.ts";

useIsolatedHome();

const { extractSymbols } = await import("../src/core/symbols.ts");
const { detectLanguage } = await import("../src/core/scan-policy.ts");
const { indexRepo } = await import("../src/core/indexer.ts");
const { searchCodeMap } = await import("../src/core/search.ts");

const cSource = `#include <stdio.h>

struct Point {
  int x;
  int y;
};

enum Color { RED, GREEN };

int add_numbers(int a, int b) {
  return a + b;
}

static void log_message(const char *msg) {
  printf("%s\\n", msg);
}

int forward_only(int a);
`;

const cppSource = `namespace geo {

class Shape {
public:
  virtual double area() const;
};

double Shape::area() const {
  return 0.0;
}

template <typename T>
T max_value(T a, T b) {
  return a > b ? a : b;
}

}  // namespace geo
`;

test("detectLanguage normalizes C/C++ extensions to canonical tags", () => {
  for (const path of ["src/main.c", "include/util.h"]) assert.equal(detectLanguage(path), "c");
  for (const path of ["src/app.cpp", "src/app.cc", "src/app.cxx", "include/app.hpp", "include/app.hh", "include/app.hxx"]) {
    assert.equal(detectLanguage(path), "cpp");
  }
});

test("extractSymbols reads C aggregates and function definitions", () => {
  const symbols = extractSymbols(cSource, "c");
  const byName = new Map(symbols.map((symbol) => [symbol.name, symbol.kind]));
  assert.equal(byName.get("Point"), "struct");
  assert.equal(byName.get("Color"), "enum");
  assert.equal(byName.get("add_numbers"), "function");
  assert.equal(byName.get("log_message"), "function");
  // Fields, includes and call statements must not become symbols.
  assert.ok(!byName.has("x"), JSON.stringify([...byName]));
  assert.ok(!byName.has("printf"), JSON.stringify([...byName]));
  assert.ok(!byName.has("return"), JSON.stringify([...byName]));
});

test("extractSymbols reads C++ classes, methods and free functions", () => {
  const symbols = extractSymbols(cppSource, "cpp");
  const byName = new Map(symbols.map((symbol) => [symbol.name, symbol.kind]));
  assert.equal(byName.get("Shape"), "class");
  assert.equal(byName.get("area"), "method");
  assert.equal(byName.get("max_value"), "function");
  assert.ok(!byName.has("namespace"), JSON.stringify([...byName]));
});

test("C and C++ symbols are searchable end to end", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-codemap-c-cpp-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "math.c"), cSource);
  writeFileSync(join(root, "src", "shape.cpp"), cppSource);

  indexRepo({ cwd: root, approve: true });

  assert.ok(searchCodeMap({ cwd: root, query: "add_numbers", limit: 5 }).some((result) => result.kind === "function"));
  assert.ok(searchCodeMap({ cwd: root, query: "Point", limit: 5 }).some((result) => result.kind === "struct"));
  assert.ok(searchCodeMap({ cwd: root, query: "Shape", limit: 5 }).some((result) => result.kind === "class"));
  assert.ok(searchCodeMap({ cwd: root, query: "max_value", limit: 5 }).some((result) => result.kind === "function"));
});
