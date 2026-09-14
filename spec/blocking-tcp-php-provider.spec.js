// @ts-check

import {describe, expect, it} from "@velocious/testing"
import {protectedEntryName} from "../src/stdlib-providers.js"
import {executeTask037ProviderScenario} from "./support/task037-provider-harness.js"

const connect = protectedEntryName("php", "semantifold.socket-client", "v1_connect")
const readLine = protectedEntryName("php", "semantifold.text-stream", "v1_read_line")
const close = protectedEntryName("php", "semantifold.resource", "v1_close")
const writeLine = protectedEntryName("php", "semantifold.output", "v1_write_line")

describe("blocking TCP protected PHP provider", () => {
  it("validates inputs and normalizes every connect/setup failure without resource escape", async () => {
    const result = await executeTask037ProviderScenario(`
$categories = [];
foreach ([["", 80], ["host", 0], ["host", 65536]] as [$host, $port]) {
  try { ${connect}($host, $port); $categories[] = "bad-success"; }
  catch (Throwable $error) { $categories[] = task037_category($error); }
}
foreach (["false", "warning", "throw"] as $mode) {
  $task037["connectMode"] = $mode;
  try { ${connect}("resolver.example", 80); $categories[] = "bad-success"; }
  catch (Throwable $error) { $categories[] = task037_category($error); }
}
$task037["connectMode"] = "ok"; $task037["setupMode"] = "throw";
try { ${connect}("timeout.example", 80); $categories[] = "bad-success"; }
catch (Throwable $error) { $categories[] = task037_category($error); }
echo json_encode(["categories" => $categories, "connectCalls" => $task037["connectCalls"],
  "closeCalls" => $task037["closeCalls"]], JSON_THROW_ON_ERROR);
`)

    expect(result).toEqual({
      categories: ["InvalidHost", "InvalidPort", "InvalidPort", "ConnectionFailure", "ConnectionFailure",
        "ConnectionFailure", "ConnectionFailure"],
      closeCalls: 1,
      connectCalls: 4
    })
  })

  it("retains line bytes, handles final data once, and validates split UTF-8 incrementally", async () => {
    const result = await executeTask037ProviderScenario(`
$resource = ${connect}("host", 80);
$task037["reads"] = ["a\\n", "b\\r\\n", "\\n", "\\xE7", "\\xB5", "\\x82", false];
$lines = [${readLine}($resource), ${readLine}($resource), ${readLine}($resource), ${readLine}($resource),
  ${readLine}($resource)];
${close}($resource);
echo json_encode(["lines" => $lines, "closeCalls" => $task037["closeCalls"]], JSON_THROW_ON_ERROR);
`)

    expect(result).toEqual({closeCalls: 1, lines: ["a\n", "b\r\n", "\n", "終", null]})
  })

  it("distinguishes read failure from EOF and reports every invalid UTF-8 category before explicit cleanup", async () => {
    const result = await executeTask037ProviderScenario(`
$cases = [["\\xC2 "] , ["\\xC0\\x80"], ["\\xED\\xA0\\x80"], ["\\xF4\\x90\\x80\\x80"], ["\\xE2\\x82"]];
$categories = [];
foreach ($cases as $chunks) {
  $resource = ${connect}("host", 80); $task037["reads"] = $chunks; $task037["eof"] = true;
  try { ${readLine}($resource); $categories[] = "bad-success"; }
  catch (Throwable $error) { $categories[] = task037_category($error); }
  finally { ${close}($resource); }
}
$resource = ${connect}("host", 80); $task037["reads"] = []; $task037["eof"] = false;
try { ${readLine}($resource); $categories[] = "bad-success"; }
catch (Throwable $error) { $categories[] = task037_category($error); }
finally { ${close}($resource); }
echo json_encode(["categories" => $categories, "closeCalls" => $task037["closeCalls"]], JSON_THROW_ON_ERROR);
`)

    expect(result).toEqual({
      categories: ["DecodeFailure", "DecodeFailure", "DecodeFailure", "DecodeFailure", "DecodeFailure", "ReadFailure"],
      closeCalls: 6
    })
  })

  it("completes short writes once and makes the first close attempt terminal", async () => {
    const result = await executeTask037ProviderScenario(`
$task037["writes"] = [1, 2, 100]; ${writeLine}("é");
$output = $task037["output"];
$writeFailures = [];
foreach ([[0], [false], ["warning"], ["throw"]] as $writes) {
  $task037["writes"] = $writes;
  try { ${writeLine}("x"); $writeFailures[] = "bad-success"; }
  catch (Throwable $error) { $writeFailures[] = task037_category($error); }
}
$resource = ${connect}("host", 80); $task037["closeMode"] = "false";
try { ${close}($resource); $first = "bad-success"; } catch (Throwable $error) { $first = task037_category($error); }
try { ${close}($resource); $second = "bad-success"; } catch (Throwable $error) { $second = task037_category($error); }
try { ${readLine}($resource); $read = "bad-success"; } catch (Throwable $error) { $read = task037_category($error); }
echo json_encode(["output" => $output, "writeFailures" => $writeFailures, "first" => $first, "second" => $second,
  "read" => $read, "closeCalls" => $task037["closeCalls"], "readCalls" => $task037["readCalls"]], JSON_THROW_ON_ERROR);
`)

    expect(result).toEqual({
      closeCalls: 1,
      first: "CloseFailure",
      output: "é\n",
      read: "ResourceClosed",
      readCalls: 0,
      second: "ResourceClosed",
      writeFailures: ["WriteFailure", "WriteFailure", "WriteFailure", "WriteFailure"]
    })
  })
})
