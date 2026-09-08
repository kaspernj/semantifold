// @ts-check

import assert from "node:assert/strict"
import {createServer} from "node:http"
import {mkdir, mkdtemp, readFile, rm, writeFile} from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {describe, expect, it} from "@velocious/testing"
import {
  createGeneratedArtifactSet,
  discoverCanonicalToolchain,
  generateArtifactSet,
  parse,
  runAcceptanceStages
} from "../index.js"
import {executeFileWithDeadline} from "../src/subprocess.js"

const profiles = [
  ["fixtures/program.js", "5\n"],
  ["fixtures/scalars/program.js", "yes\n"],
  ["fixtures/locals/program.js", "yes\n"],
  ["fixtures/operators/program.js", "typed:operators\n"],
  ["fixtures/statements/program.js", "checking\nyes\nmatched\nfallback\n"]
]
const browserCsp = "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'; base-uri 'none'; form-action 'none'"

describe("WebAssembly external validator and browser acceptance", () => {
  it("validates and executes every Tasks 001-004 profile with WABT, Node, and strict-CSP Chromium", async () => {
    const validator = await discoverCanonicalToolchain("wasm-validate")
    const node = await discoverCanonicalToolchain("node")
    const chromium = await discoverCanonicalToolchain("chromium")
    const cases = []

    for (const [filename, expected] of profiles) {
      const source = await readFile(new URL(filename, import.meta.url), "utf8")

      cases.push({expected, filename, source})
    }
    cases.push({
      expected: "nested browser\u0000🙂\n-9007199254740991\ntrue\nfallback\n",
      filename: "browser-boundaries.ts",
      source: `function join(left: string, right: string): string { return left + right }
function wrap(left: string, right: string): string { return join(left, right) + "🙂" }
function choose(flag: boolean, fallback: string): string {
  if (flag) return "selected"
  else return fallback
}
console.log(wrap("nested ", "browser\\u0000"))
console.log(-9007199254740991)
console.log(!false)
console.log(choose(false, "fallback"))
`
    })

    for (const profile of cases) {
      const language = profile.filename.endsWith(".ts") ? "typescript" : "javascript"
      const generated = generateArtifactSet({
        language: "wasm",
        module: parse({filename: profile.filename, language, source: profile.source}),
        role: "binary"
      })
      const accepted = await runAcceptanceStages({
        artifacts: withNodeRunner(generated),
        environment: {LC_ALL: "C.UTF-8", PATH: process.env.PATH, TZ: "UTC"},
        stages: [
          {arguments: ["program.wasm"], stage: "validate", tool: validator},
          {arguments: ["node-runner.mjs"], stage: "instantiate", tool: node}
        ],
        target: "wasm",
        timeoutMs: 20_000
      })

      expect(accepted.stages[0].stdout).toEqual("")
      expect(accepted.stages[0].stderr).toEqual("")
      expect(accepted.stages[1].stdout).toEqual(profile.expected)
      expect(accepted.stages[1].stderr).toEqual("")

      const browser = await executeInBrowser(generated, chromium)

      expect(browser.stdout).toContain('data-semantifold="pass"')
      expect(browser.stdout).toContain(`data-semantifold-output="${Buffer.from(profile.expected).toString("hex")}"`)
      expect(browser.stdout).toContain(`<pre id="output">${escapeHtml(profile.expected)}</pre>`)
      assert.doesNotMatch(browser.stdout, /ERROR\[/u)
    }
  })
})

/**
 * Adds an acceptance-only Node host that exercises the generated ABI.
 * @param {import("../src/semantic/types.js").GeneratedArtifactSet} generated - Browser Wasm artifact set.
 * @returns {import("../src/semantic/types.js").GeneratedArtifactSet} Set with the local runner.
 */
function withNodeRunner(generated) {
  const runner = `import {readFile} from "node:fs/promises"

const bytes = await readFile(new URL("./program.wasm", import.meta.url))
let instance
let output = ""
const result = await WebAssembly.instantiate(bytes, {semantifold: {
  print_bool(value) {
    if (value !== 0 && value !== 1) throw new TypeError("non-canonical Boolean")
    output += value === 1 ? "true\\n" : "false\\n"
  },
  print_i64(value) { output += value.toString(10) + "\\n" },
  print_string(pointer, length) {
    const memory = instance.exports.memory
    if (!Number.isInteger(pointer) || pointer < 0 || !Number.isInteger(length) || length < 0 || pointer + length > memory.buffer.byteLength) {
      throw new RangeError("invalid string range")
    }
    output += new TextDecoder("utf-8", {fatal: true}).decode(new Uint8Array(memory.buffer, pointer, length)) + "\\n"
  }
}})
instance = result.instance
instance.exports.run()
process.stdout.write(output)
`

  return createGeneratedArtifactSet({
    artifacts: [...generated.artifacts, {
      content: runner,
      contentKind: "text",
      mediaType: "text/javascript",
      ownership: "generated",
      path: "node-runner.mjs",
      provenance: {
        kind: "synthetic",
        reason: "Acceptance-only Node host for the browser Wasm ABI.",
        relatedOrigins: []
      },
      role: "support"
    }],
    entry: generated.entry,
    metadata: generated.metadata,
    target: generated.target
  })
}

/**
 * Serves and executes one generated set with bounded loopback-only Chromium.
 * @param {import("../src/semantic/types.js").GeneratedArtifactSet} generated - Browser Wasm artifacts.
 * @param {import("../src/semantic/types.js").DiscoveredToolchain} chromium - Qualified browser.
 * @returns {Promise<{stderr: string, stdout: string}>} Captured browser result.
 */
async function executeInBrowser(generated, chromium) {
  const root = await mkdtemp(path.join(os.tmpdir(), "semantifold-wasm-browser-"))
  const artifactRoot = path.join(root, "artifacts")
  const profile = path.join(root, "profile")
  const artifacts = new Map(generated.artifacts.map((artifact) => [`/${artifact.path}`, {
    filename: path.join(artifactRoot, ...artifact.path.split("/")),
    mediaType: artifact.mediaType
  }]))
  const server = createServer(async (request, response) => {
    const artifact = artifacts.get(new URL(request.url ?? "/", "http://127.0.0.1").pathname)

    response.setHeader("Cache-Control", "no-store")
    response.setHeader("Content-Security-Policy", browserCsp)
    response.setHeader("X-Content-Type-Options", "nosniff")
    if (request.method != "GET" || !artifact) {
      response.writeHead(404, {"Content-Type": "text/plain; charset=utf-8"})
      response.end("not found\n")
      return
    }
    try {
      response.writeHead(200, {"Content-Type": artifact.mediaType})
      response.end(await readFile(artifact.filename))
    } catch {
      response.destroy()
    }
  })

  server.requestTimeout = 5_000
  server.headersTimeout = 5_000
  try {
    await Promise.all([mkdir(profile), ...generated.artifacts.map(async (artifact) => {
      const filename = path.join(artifactRoot, ...artifact.path.split("/"))

      await mkdir(path.dirname(filename), {recursive: true})
      await writeFile(filename, artifact.content)
    })])
    const port = await listenOnLoopback(server)

    return await executeFileWithDeadline({
      arguments: [
        "--headless=new",
        "--no-sandbox",
        "--disable-gpu",
        "--disable-background-networking",
        "--disable-component-update",
        "--disable-default-apps",
        "--disable-domain-reliability",
        "--disable-extensions",
        "--disable-sync",
        "--metrics-recording-only",
        "--no-default-browser-check",
        "--no-first-run",
        "--no-proxy-server",
        "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1",
        "--lang=en-US",
        `--user-data-dir=${profile}`,
        "--virtual-time-budget=5000",
        "--dump-dom",
        `http://127.0.0.1:${port}/index.html`
      ],
      cwd: root,
      environment: {HOME: root, LC_ALL: "C.UTF-8", PATH: process.env.PATH ?? "", TZ: "UTC"},
      executable: chromium.executable,
      maxBuffer: 4 * 1024 * 1024,
      timeoutMs: 20_000
    })
  } finally {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
    await rm(root, {force: true, recursive: true})
  }
}

/**
 * Starts one server on a kernel-assigned loopback port.
 * @param {import("node:http").Server} server - Server to start.
 * @returns {Promise<number>} Assigned TCP port.
 */
async function listenOnLoopback(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  const address = server.address()

  if (!address || typeof address == "string") throw new Error("Loopback server did not expose a TCP port.")

  return address.port
}

/**
 * Escapes deterministic text-node content as serialized HTML.
 * @param {string} value - Text content.
 * @returns {string} HTML text.
 */
function escapeHtml(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
}
