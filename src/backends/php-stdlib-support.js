// @ts-check

import {protectedEntryName} from "../semantic/stdlib.js"

const task037Modules = new Set([
  "semantifold.output", "semantifold.resource", "semantifold.socket-client", "semantifold.text-stream"
])

/** @typedef {{close?: string, connect?: string, eof?: string, read?: string, setup?: string, write?: string}} PhpNativeSeam */

/**
 * Generates one isolated PHP provider artifact for the Task 037 canonical module.
 * The optional native seam is generator-internal and exists only for real-runtime provider tests.
 * @param {string} module - Exact canonical module identity.
 * @param {readonly string[]} operations - Reachable operations for this provider.
 * @param {PhpNativeSeam} [seam] - Protected test-owned native call names.
 * @returns {string} Complete PHP provider source.
 */
export function generateTask037PhpProviderContent(module, operations, seam = {}) {
  if (!task037Modules.has(module)) throw new RangeError(`Unknown Task 037 PHP provider module '${module}'.`)
  const used = new Set(operations)
  const supported = module == "semantifold.resource" ? "v1_close" : module == "semantifold.socket-client" ? "v1_connect" :
    module == "semantifold.text-stream" ? "v1_read_line" : "v1_write_line"

  if ([...used].some((operation) => operation != supported)) {
    throw new RangeError(`Unknown operation selected for Task 037 PHP provider module '${module}'.`)
  }
  const body = module == "semantifold.resource" ? resourceProvider(used, seam) :
    module == "semantifold.socket-client" ? socketClientProvider(used, seam) :
      module == "semantifold.text-stream" ? textStreamProvider(used, seam) : outputProvider(used, seam)

  return `<?php\ndeclare(strict_types=1);\n/* semantifold-task037-protected-provider */\n${body}` +
    "/* semantifold-task037-protected-provider-end */\n"
}

/**
 * Generates the canonical resource carrier and optional close operation.
 * @param {Set<string>} used - Reachable operations.
 * @param {PhpNativeSeam} seam - Native seam.
 * @returns {string} Provider body.
 */
function resourceProvider(used, seam) {
  const entry = protectedEntryName("php", "semantifold.resource", "v1_close")
  const nativeClose = seam.close ? `${seam.close}($handle)` : "fclose($handle)"
  const closeFunction = used.has("v1_close") ? `
function ${entry}(ByteStream $resource): void {
  $handle = $resource->__semantifoldClaimForClose();
  $warning = null;
  set_error_handler(static function(int $severity, string $message) use (&$warning): bool {
    $warning = substr($message, 0, 256); return true;
  });
  try {
    try { $closed = ${nativeClose}; } catch (Throwable $error) {
      throw new CloseFailure("CloseFailure", 0, $error);
    }
  } finally { restore_error_handler(); }
  if ($warning !== null || $closed !== true) throw new CloseFailure("CloseFailure");
}
` : ""

  return `final class CloseFailure extends RuntimeException {}
final class ResourceClosed extends RuntimeException {}
final class ByteStream {
  private mixed $handle;
  private bool $closed = false;
  private function __construct(mixed $handle) { $this->handle = $handle; }
  public static function __semantifoldFromNative(mixed $handle): self {
    if (!is_resource($handle)) throw new RuntimeException("invalid private stream");
    return new self($handle);
  }
  public function __semantifoldClaimForRead(): mixed {
    if ($this->closed) throw new ResourceClosed("ResourceClosed");
    return $this->handle;
  }
  public function __semantifoldClaimForClose(): mixed {
    if ($this->closed) throw new ResourceClosed("ResourceClosed");
    $this->closed = true;
    return $this->handle;
  }
}
${closeFunction}`
}

/**
 * Generates exact validation and transactional blocking stream acquisition.
 * @param {Set<string>} used - Reachable operations.
 * @param {PhpNativeSeam} seam - Native seam.
 * @returns {string} Provider body.
 */
function socketClientProvider(used, seam) {
  const entry = protectedEntryName("php", "semantifold.socket-client", "v1_connect")

  if (!used.has("v1_connect")) return "final class InvalidHost extends RuntimeException {}\n" +
    "final class InvalidPort extends RuntimeException {}\nfinal class ConnectionFailure extends RuntimeException {}\n"
  const nativeConnect = seam.connect
    ? `${seam.connect}($host, $port, $errno, $errorMessage)`
    : "fsockopen($host, $port, $errno, $errorMessage)"
  const nativeClose = seam.close ? `${seam.close}($handle)` : "fclose($handle)"
  const setup = seam.setup ? `${seam.setup}($handle);` : ""

  return `final class InvalidHost extends RuntimeException {}
final class InvalidPort extends RuntimeException {}
final class ConnectionFailure extends RuntimeException {}
function ${entry}(string $host, int $port): ByteStream {
  if ($host === "" || preg_match("//u", $host) !== 1 || str_contains($host, "://")) {
    throw new InvalidHost("InvalidHost");
  }
  if ($port < 1 || $port > 65535) throw new InvalidPort("InvalidPort");
  $errno = 0; $errorMessage = ""; $warning = null;
  set_error_handler(static function(int $severity, string $message) use (&$warning): bool {
    $warning = substr($message, 0, 256); return true;
  });
  try {
    try { $handle = ${nativeConnect}; } catch (Throwable $error) {
      throw new ConnectionFailure("ConnectionFailure", 0, $error);
    }
  } finally { restore_error_handler(); }
  if ($warning !== null || !is_resource($handle)) throw new ConnectionFailure("ConnectionFailure");
  try {
    ${setup}
    return ByteStream::__semantifoldFromNative($handle);
  } catch (Throwable $error) {
    $cleanupWarning = null;
    set_error_handler(static function(int $severity, string $message) use (&$cleanupWarning): bool {
      $cleanupWarning = substr($message, 0, 256); return true;
    });
    try { try { ${nativeClose}; } catch (Throwable) {} } finally { restore_error_handler(); }
    throw new ConnectionFailure("ConnectionFailure", 0, $error);
  }
}
`
}

/**
 * Generates blocking line reads with explicit EOF and incremental UTF-8 validation.
 * @param {Set<string>} used - Reachable operations.
 * @param {PhpNativeSeam} seam - Native seam.
 * @returns {string} Provider body.
 */
function textStreamProvider(used, seam) {
  const entry = protectedEntryName("php", "semantifold.text-stream", "v1_read_line")

  if (!used.has("v1_read_line")) return "final class ReadFailure extends RuntimeException {}\n" +
    "final class DecodeFailure extends RuntimeException {}\n"
  const nativeRead = seam.read ? `${seam.read}($handle, 8192)` : "fgets($handle, 8192)"
  const nativeEof = seam.eof ? `${seam.eof}($handle)` : "feof($handle)"
  const validator = `${entry}__validate_utf8`

  return `final class ReadFailure extends RuntimeException {}
final class DecodeFailure extends RuntimeException {}
function ${validator}(string $chunk, int &$remaining, int &$codepoint, int &$minimum): void {
  $length = strlen($chunk);
  for ($index = 0; $index < $length; $index++) {
    $byte = ord($chunk[$index]);
    if ($remaining === 0) {
      if ($byte <= 0x7f) continue;
      if ($byte >= 0xc2 && $byte <= 0xdf) { $remaining = 1; $codepoint = $byte & 0x1f; $minimum = 0x80; continue; }
      if ($byte >= 0xe0 && $byte <= 0xef) { $remaining = 2; $codepoint = $byte & 0x0f; $minimum = 0x800; continue; }
      if ($byte >= 0xf0 && $byte <= 0xf4) { $remaining = 3; $codepoint = $byte & 0x07; $minimum = 0x10000; continue; }
      throw new DecodeFailure("DecodeFailure");
    }
    if ($byte < 0x80 || $byte > 0xbf) throw new DecodeFailure("DecodeFailure");
    $codepoint = ($codepoint << 6) | ($byte & 0x3f); $remaining--;
    if ($remaining === 0 && ($codepoint < $minimum || $codepoint > 0x10ffff ||
      ($codepoint >= 0xd800 && $codepoint <= 0xdfff))) throw new DecodeFailure("DecodeFailure");
  }
}
function ${entry}(ByteStream $resource): ?string {
  $handle = $resource->__semantifoldClaimForRead();
  $buffer = ""; $remaining = 0; $codepoint = 0; $minimum = 0;
  while (true) {
    $warning = null;
    set_error_handler(static function(int $severity, string $message) use (&$warning): bool {
      $warning = substr($message, 0, 256); return true;
    });
    try {
      try { $chunk = ${nativeRead}; } catch (Throwable $error) {
        throw new ReadFailure("ReadFailure", 0, $error);
      }
    } finally { restore_error_handler(); }
    if ($warning !== null) throw new ReadFailure("ReadFailure");
    if ($chunk !== false) {
      if (!is_string($chunk) || $chunk === "") throw new ReadFailure("ReadFailure");
      ${validator}($chunk, $remaining, $codepoint, $minimum);
      $buffer .= $chunk;
      if (str_ends_with($buffer, "\\n")) return $buffer;
      continue;
    }
    $eofWarning = null;
    set_error_handler(static function(int $severity, string $message) use (&$eofWarning): bool {
      $eofWarning = substr($message, 0, 256); return true;
    });
    try {
      try { $eof = ${nativeEof}; } catch (Throwable $error) {
        throw new ReadFailure("ReadFailure", 0, $error);
      }
    } finally { restore_error_handler(); }
    if ($eofWarning !== null || $eof !== true) throw new ReadFailure("ReadFailure");
    if ($remaining !== 0) throw new DecodeFailure("DecodeFailure");
    return $buffer === "" ? null : $buffer;
  }
}
`
}

/**
 * Generates complete UTF-8 stdout writes through positive-progress native calls.
 * @param {Set<string>} used - Reachable operations.
 * @param {PhpNativeSeam} seam - Native seam.
 * @returns {string} Provider body.
 */
function outputProvider(used, seam) {
  const entry = protectedEntryName("php", "semantifold.output", "v1_write_line")

  if (!used.has("v1_write_line")) return "final class WriteFailure extends RuntimeException {}\n"
  const nativeWrite = seam.write ? `${seam.write}($remainingBytes)` : "fwrite(STDOUT, $remainingBytes)"

  return `final class WriteFailure extends RuntimeException {}
function ${entry}(string $text): void {
  $bytes = str_ends_with($text, "\\n") ? $text : $text . "\\n";
  $length = strlen($bytes); $offset = 0;
  while ($offset < $length) {
    $remainingBytes = substr($bytes, $offset); $warning = null;
    set_error_handler(static function(int $severity, string $message) use (&$warning): bool {
      $warning = substr($message, 0, 256); return true;
    });
    try {
      try { $written = ${nativeWrite}; } catch (Throwable $error) {
        throw new WriteFailure("WriteFailure", 0, $error);
      }
    } finally { restore_error_handler(); }
    if ($warning !== null || !is_int($written) || $written <= 0 || $written > strlen($remainingBytes)) {
      throw new WriteFailure("WriteFailure");
    }
    $offset += $written;
  }
}
`
}
