// @ts-check

import {protectedEntryName} from "../semantic/stdlib.js"

const task037Modules = new Set([
  "semantifold.output", "semantifold.resource", "semantifold.socket-client", "semantifold.text-stream"
])

/**
 * Generates one isolated PHP provider artifact for the Task 037 canonical module.
 * Native behavior is filled by the provider owner without exposing these names to portable source.
 * @param {string} module - Exact canonical module identity.
 * @param {readonly string[]} operations - Reachable operations for this provider.
 * @returns {string} Complete PHP provider source.
 */
export function generateTask037PhpProviderContent(module, operations) {
  if (!task037Modules.has(module)) throw new RangeError(`Unknown Task 037 PHP provider module '${module}'.`)
  const used = new Set(operations)
  const close = protectedEntryName("php", "semantifold.resource", "v1_close")
  const connect = protectedEntryName("php", "semantifold.socket-client", "v1_connect")
  const readLine = protectedEntryName("php", "semantifold.text-stream", "v1_read_line")
  const writeLine = protectedEntryName("php", "semantifold.output", "v1_write_line")
  let body = "<?php\ndeclare(strict_types=1);\n/* semantifold-task037-protected-provider */\n"

  if (module == "semantifold.resource") {
    body += "final class CloseFailure extends RuntimeException {}\nfinal class ResourceClosed extends RuntimeException {}\n"
    body += "final class ByteStream { public function __construct() {} }\n"
    if (used.has("v1_close")) body += `function ${close}(ByteStream $resource): void { throw new CloseFailure("CloseFailure"); }\n`
  } else if (module == "semantifold.socket-client") {
    body += "final class InvalidHost extends RuntimeException {}\nfinal class InvalidPort extends RuntimeException {}\nfinal class ConnectionFailure extends RuntimeException {}\n"
    if (used.has("v1_connect")) {
      body += `function ${connect}(string $host, int $port): ByteStream { throw new ConnectionFailure("ConnectionFailure"); }\n`
    }
  } else if (module == "semantifold.text-stream") {
    body += "final class ReadFailure extends RuntimeException {}\nfinal class DecodeFailure extends RuntimeException {}\n"
    if (used.has("v1_read_line")) {
      body += `function ${readLine}(ByteStream $resource): ?string { throw new ReadFailure("ReadFailure"); }\n`
    }
  } else {
    body += "final class WriteFailure extends RuntimeException {}\n"
    if (used.has("v1_write_line")) {
      body += `function ${writeLine}(string $text): void { throw new WriteFailure("WriteFailure"); }\n`
    }
  }
  return `${body}/* semantifold-task037-protected-provider-end */\n`
}
