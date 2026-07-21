import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { useIsolatedHome } from "./helpers/repo-fixture.ts";

useIsolatedHome();

const { extractSymbols } = await import("../src/core/symbols.ts");
const { indexRepo } = await import("../src/core/indexer.ts");
const { searchCodeMap } = await import("../src/core/search.ts");

const byName = (text: string, language: string) => new Map(extractSymbols(text, language).map((symbol) => [symbol.name, symbol.kind]));

test("Go: funcs, methods, and type declarations; no control keywords", () => {
  const map = byName(`package main

// comment
type Server struct {
	addr string
}

type Handler interface {
	Serve()
}

type Alias = Server

func NewServer(addr string) *Server {
	if addr == "" {
		return nil
	}
	return &Server{addr}
}

func (s *Server) Serve() error {
	for {
	}
}
`, "go");
  assert.equal(map.get("Server"), "class");
  assert.equal(map.get("Handler"), "interface");
  assert.equal(map.get("Alias"), "type");
  assert.equal(map.get("NewServer"), "function");
  assert.equal(map.get("Serve"), "method");
  assert.ok(!map.has("if") && !map.has("for") && !map.has("return"), JSON.stringify([...map]));
});

test("Rust: fn/struct/enum/trait/type with visibility and qualifiers", () => {
  const map = byName(`pub struct Config {
    pub name: String,
}

enum State { Idle, Running }

pub trait Runner {
    fn run(&self);
}

pub async fn start(config: Config) -> Result<(), Error> {
    match config {
    }
}

type Bytes = Vec<u8>;
`, "rs");
  assert.equal(map.get("Config"), "class");
  assert.equal(map.get("State"), "type");
  assert.equal(map.get("Runner"), "interface");
  assert.equal(map.get("start"), "function");
  assert.equal(map.get("run"), "function");
  assert.equal(map.get("Bytes"), "type");
  assert.ok(!map.has("match"), JSON.stringify([...map]));
});

test("Java: class/interface/enum/record and access-qualified methods", () => {
  const map = byName(`public final class OrderService {
    private final Repo repo;

    public OrderService(Repo repo) {
        this.repo = repo;
    }

    public Order findOrder(long id) {
        if (id < 0) {
            return null;
        }
        return repo.get(id);
    }
}

interface Repo {}

enum Status { OPEN, CLOSED }
`, "java");
  assert.equal(map.get("OrderService"), "class");
  assert.equal(map.get("Repo"), "interface");
  assert.equal(map.get("Status"), "type");
  assert.equal(map.get("findOrder"), "method");
  // A bare `if (...)` line must not be read as a method.
  assert.ok(!map.has("if"), JSON.stringify([...map]));
});

test("Kotlin: fun and class/interface/object", () => {
  const map = byName(`open class Repository(private val db: Db) {
    fun findById(id: Long): Row? {
        return db.query(id)
    }

    suspend fun refresh() {}
}

interface Cache

object Registry
`, "kt");
  assert.equal(map.get("Repository"), "class");
  assert.equal(map.get("Cache"), "interface");
  assert.equal(map.get("Registry"), "class");
  assert.equal(map.get("findById"), "function");
  assert.equal(map.get("refresh"), "function");
});

test("Ruby: def/self.def/class/module", () => {
  const map = byName(`module Billing
  class Invoice
    def total
      @lines.sum
    end

    def self.create(attrs)
      new(attrs)
    end
  end
end
`, "rb");
  assert.equal(map.get("Billing"), "module");
  assert.equal(map.get("Invoice"), "class");
  assert.equal(map.get("total"), "method");
  assert.equal(map.get("create"), "method");
});

test("PHP: class/interface/trait and functions/methods", () => {
  const map = byName(`<?php
interface Logger {}

trait Timestamps {}

final class User implements Logger {
    public function getName(): string {
        return $this->name;
    }
}

function make_user(string $name): User {
    return new User($name);
}
`, "php");
  assert.equal(map.get("Logger"), "interface");
  assert.equal(map.get("Timestamps"), "interface");
  assert.equal(map.get("User"), "class");
  assert.equal(map.get("getName"), "method");
  assert.equal(map.get("make_user"), "function");
});

test("line-based symbols are searchable end to end", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-codemap-line-symbols-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "server.go"), "package main\n\nfunc StartHttpServer() error {\n\treturn nil\n}\n");
  writeFileSync(join(root, "src", "lib.rs"), "pub fn parseConfigFile() -> u32 {\n    0\n}\n");

  indexRepo({ cwd: root, approve: true });

  assert.ok(searchCodeMap({ cwd: root, query: "StartHttpServer", limit: 5 }).some((result) => result.kind === "function"));
  assert.ok(searchCodeMap({ cwd: root, query: "parseConfigFile", limit: 5 }).some((result) => result.kind === "function"));
});
