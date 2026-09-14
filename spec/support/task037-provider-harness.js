// @ts-check

import {mkdtemp, rm, writeFile} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join} from "node:path"
import {generateTask037PhpProviderContent} from "../../src/backends/php-stdlib-support.js"
import {executeFileWithDeadline} from "../../src/subprocess.js"
import {deterministicEnvironment, discoverCanonicalToolchain} from "../../src/toolchains.js"

const seam = Object.freeze({
  close: "task037_native_close",
  connect: "task037_native_connect",
  eof: "task037_native_eof",
  read: "task037_native_read",
  setup: "task037_native_setup",
  write: "task037_native_write"
})

/**
 * Executes one generated Task 037 provider scenario through the canonical real PHP runtime.
 * @param {string} script - PHP statements that emit one JSON document.
 * @param {{nativeConnect?: boolean}} [options] - Protected selection of the genuine connect primitive.
 * @returns {Promise<Record<string, unknown>>} Parsed scenario result.
 */
export async function executeTask037ProviderScenario(script, options = {}) {
  const php = await discoverCanonicalToolchain("php82")
  const directory = await mkdtemp(join(tmpdir(), "semantifold-task037-provider-"))

  try {
    const providers = [
      ["resource.php", "semantifold.resource", ["v1_close"]],
      ["socket-client.php", "semantifold.socket-client", ["v1_connect"]],
      ["text-stream.php", "semantifold.text-stream", ["v1_read_line"]],
      ["output.php", "semantifold.output", ["v1_write_line"]]
    ]

    for (const [filename, module, operations] of providers) {
      const providerSeam = options.nativeConnect && module == "semantifold.socket-client" ? {...seam, connect: undefined} : seam

      await writeFile(join(directory, /** @type {string} */ (filename)), generateTask037PhpProviderContent(
        /** @type {string} */ (module), /** @type {string[]} */ (operations), providerSeam), "utf8")
    }
    await writeFile(join(directory, "scenario.php"), `<?php\ndeclare(strict_types=1);\n${nativeSeams}
require __DIR__ . "/resource.php";
require __DIR__ . "/socket-client.php";
require __DIR__ . "/text-stream.php";
require __DIR__ . "/output.php";
${script}
`, "utf8")
    const result = await executeFileWithDeadline({
      arguments: ["scenario.php"],
      cwd: directory,
      environment: deterministicEnvironment(),
      executable: php.executable,
      maxBuffer: 256 * 1024,
      timeoutMs: 10_000
    })

    if (result.stderr != "") throw new Error(`Task 037 provider scenario wrote stderr: ${result.stderr}`)
    return /** @type {Record<string, unknown>} */ (JSON.parse(result.stdout))
  } finally {
    await rm(directory, {force: true, recursive: true})
  }
}

const nativeSeams = String.raw`
$task037 = [
  "closeCalls" => 0, "closeMode" => "ok", "connectCalls" => 0, "connectMode" => "ok",
  "eof" => true, "eofCalls" => 0, "output" => "", "reads" => [], "readCalls" => 0,
  "setupMode" => "ok", "writeCalls" => 0, "writes" => []
];
function task037_native_connect(string $host, int $port, int &$errno, string &$message): mixed {
  global $task037; $task037["connectCalls"]++;
  if ($task037["connectMode"] === "warning") { trigger_error("private connect warning", E_USER_WARNING); return false; }
  if ($task037["connectMode"] === "throw") { throw new RuntimeException("private connect exception"); }
  if ($task037["connectMode"] === "false") { $errno = 111; $message = "private refusal"; return false; }
  return fopen("php://temp", "r+");
}
function task037_native_setup(mixed $handle): void {
  global $task037; if ($task037["setupMode"] === "throw") throw new RuntimeException("private setup exception");
}
function task037_native_read(mixed $handle, int $length): mixed {
  global $task037; $task037["readCalls"]++;
  if (count($task037["reads"]) === 0) return false;
  $next = array_shift($task037["reads"]);
  if ($next === "__warning__") { trigger_error("private read warning", E_USER_WARNING); return false; }
  if ($next === "__throw__") throw new RuntimeException("private read exception");
  return $next;
}
function task037_native_eof(mixed $handle): bool {
  global $task037; $task037["eofCalls"]++;
  if ($task037["eof"] === "warning") { trigger_error("private eof warning", E_USER_WARNING); return false; }
  return $task037["eof"] === true;
}
function task037_native_close(mixed $handle): bool {
  global $task037; $task037["closeCalls"]++;
  if ($task037["closeMode"] === "warning") { trigger_error("private close warning", E_USER_WARNING); return false; }
  if ($task037["closeMode"] === "throw") throw new RuntimeException("private close exception");
  if ($task037["closeMode"] === "false") return false;
  return fclose($handle);
}
function task037_native_write(string $bytes): mixed {
  global $task037; $task037["writeCalls"]++;
  $next = count($task037["writes"]) === 0 ? strlen($bytes) : array_shift($task037["writes"]);
  if ($next === "warning") { trigger_error("private write warning", E_USER_WARNING); return false; }
  if ($next === "throw") throw new RuntimeException("private write exception");
  if ($next === false || $next === 0) return $next;
  $task037["output"] .= substr($bytes, 0, $next); return $next;
}
function task037_category(Throwable $error): string { return get_class($error); }
`
