// @ts-check

import {generateTask037PhpProviderContent} from "./php-stdlib-support.js"

/**
 * @typedef {"php" | "ruby" | "javascript" | "typescript"} StdlibProviderTarget
 * @typedef {{when: (operations: Set<string>) => boolean, text: string}} SupportSegment
 */

/**
 * Emits the protected native entry shims that portable code is allowed to call.
 * @param {StdlibProviderTarget} language - Adopted target.
 * @param {readonly string[]} operations - Used canonical operations in contract order.
 * @returns {string[]} One shim line per used operation.
 */
function providerShims(language, operations) {
  const prefix = `__semantifold_provider_${language}_`
  const shims = []

  for (const operation of operations) {
    if (language == "php") {
      if (operation == "probeEffect") shims.push(`function ${prefix}probeEffect(string $label, int $value, bool $fail): int { return probeEffect($label, $value, $fail); }`)
      else if (operation == "probeAcquire") shims.push(`function ${prefix}probeAcquire(bool $fail): ProbeResource { return probeAcquire($fail); }`)
      else if (operation == "probeRead") shims.push(`function ${prefix}probeRead(ProbeResource $resource, bool $fail): ?string { return probeRead($resource, $fail); }`)
      else if (operation == "probeClose") shims.push(`function ${prefix}probeClose(ProbeResource $resource, bool $fail): void { probeClose($resource, $fail); }`)
      else shims.push(`function ${prefix}probeTrace(): string { return probeTrace(); }`)
    } else if (language == "ruby") {
      const parameter = operation == "probeEffect" ? "label, value, fail_value"
        : operation == "probeAcquire" ? "fail_value"
          : operation == "probeTrace" ? "" : "resource, fail_value"
      const call = operation == "probeEffect" ? "probeEffect(label, value, fail_value)"
        : operation == "probeAcquire" ? "probeAcquire(fail_value)"
          : operation == "probeTrace" ? "probeTrace()" : `${operation}(resource, fail_value)`
      shims.push(`def ${prefix}${operation}(${parameter})\n  ${call}\nend`)
    } else if (language == "javascript") {
      const parameters = operation == "probeEffect" ? "label, value, fail"
        : operation == "probeAcquire" ? "fail"
          : operation == "probeTrace" ? "" : "resource, fail"
      const body = operation == "probeEffect" ? "return probeEffect(label, value, fail)"
        : operation == "probeAcquire" ? "return probeAcquire(fail)"
          : operation == "probeTrace" ? "return probeTrace()"
            : operation == "probeClose" ? "probeClose(resource, fail)" : "return probeRead(resource, fail)"
      shims.push(`export function ${prefix}${operation}(${parameters}) { ${body} }`)
    } else {
      const signature = operation == "probeEffect" ? "(label: string, value: number, fail: boolean): number"
        : operation == "probeAcquire" ? "(fail: boolean): ProbeResource"
          : operation == "probeTrace" ? "(): string"
            : operation == "probeClose" ? "(resource: ProbeResource, fail: boolean): void" : "(resource: ProbeResource, fail: boolean): string | null"
      const body = operation == "probeEffect" ? "return probeEffect(label, value, fail)"
        : operation == "probeAcquire" ? "return probeAcquire(fail)"
          : operation == "probeTrace" ? "return probeTrace()"
            : operation == "probeClose" ? "probeClose(resource, fail)" : "return probeRead(resource, fail)"
      shims.push(`export function ${prefix}${operation}${signature} { ${body} }`)
    }
  }
  return shims
}

/**
 * Returns the ordered tree-shakable support segments for one adopted target.
 * The full operation set reproduces the single-module support carrier byte-for-byte.
 * @param {StdlibProviderTarget} language - Adopted target.
 * @returns {SupportSegment[]} Ordered segments.
 */
function supportSegments(language) {
  const any = () => true

  /**
   * Reports whether any resource-lifecycle operation is used.
   * @param {Set<string>} operations - Used operations.
   * @returns {boolean} Whether a resource operation is used.
   */
  const resource = (operations) => operations.has("probeAcquire") || operations.has("probeRead") || operations.has("probeClose")

  if (language == "php") return [
    {when: (operations) => operations.has("probeEffect"), text: "final class ProbeOperationFailure extends RuntimeException {}\n"},
    {when: (operations) => operations.has("probeAcquire"), text: "final class ProbeAcquireFailure extends RuntimeException {}\n"},
    {when: (operations) => operations.has("probeRead"), text: "final class ProbeReadFailure extends RuntimeException {}\n"},
    {when: (operations) => operations.has("probeClose"), text: "final class ProbeCloseFailure extends RuntimeException {}\n"},
    {when: (operations) => operations.has("probeRead") || operations.has("probeClose"), text: "final class ProbeResourceClosed extends RuntimeException {}\n"},
    {
      when: resource,
      text: "final class ProbeResource {\n    public bool $closed = false;\n    public function __construct(public mixed $handle) {}\n}\n"
    },
    {when: any, text: "$GLOBALS['__semantifold_task034_trace'] = [];\n"},
    {
      when: (operations) => operations.has("probeEffect"),
      text: "function probeEffect(string $label, int $value, bool $fail): int {\n    $GLOBALS['__semantifold_task034_trace'][] = 'effect:' . $label;\n    if ($fail) throw new ProbeOperationFailure('ProbeOperationFailure');\n    return $value;\n}\n"
    },
    {
      when: (operations) => operations.has("probeAcquire"),
      text: "function probeAcquire(bool $fail): ProbeResource {\n    $GLOBALS['__semantifold_task034_trace'][] = 'acquire';\n    if ($fail) throw new ProbeAcquireFailure('ProbeAcquireFailure');\n    try { $handle = @fopen((string) getenv('SEMANTIFOLD_TASK034_PROBE_PATH'), 'rb'); }\n    catch (Throwable) { throw new ProbeAcquireFailure('ProbeAcquireFailure'); }\n    if ($handle === false) throw new ProbeAcquireFailure('ProbeAcquireFailure');\n    return new ProbeResource($handle);\n}\n"
    },
    {
      when: (operations) => operations.has("probeRead"),
      text: "function probeRead(ProbeResource $resource, bool $fail): ?string {\n    if ($resource->closed) throw new ProbeResourceClosed('ProbeResourceClosed');\n    $GLOBALS['__semantifold_task034_trace'][] = 'read';\n    if ($fail) throw new ProbeReadFailure('ProbeReadFailure');\n    try { $line = @fgets($resource->handle); }\n    catch (Throwable) { throw new ProbeReadFailure('ProbeReadFailure'); }\n    if ($line === false) {\n        if (feof($resource->handle)) return null;\n        throw new ProbeReadFailure('ProbeReadFailure');\n    }\n    return rtrim($line, \"\\r\\n\");\n}\n"
    },
    {
      when: (operations) => operations.has("probeClose"),
      text: "function probeClose(ProbeResource $resource, bool $fail): void {\n    if ($resource->closed) throw new ProbeResourceClosed('ProbeResourceClosed');\n    $GLOBALS['__semantifold_task034_trace'][] = 'close';\n    try { $closed = @fclose($resource->handle); }\n    catch (Throwable) { $resource->closed = true; throw new ProbeCloseFailure('ProbeCloseFailure'); }\n    $resource->closed = true;\n    if ($fail || !$closed) throw new ProbeCloseFailure('ProbeCloseFailure');\n}\n"
    },
    {
      when: (operations) => operations.has("probeTrace"),
      text: "function probeTrace(): string { return implode(',', $GLOBALS['__semantifold_task034_trace']); }\n"
    }
  ]
  if (language == "ruby") return [
    {when: (operations) => operations.has("probeEffect"), text: "class ProbeOperationFailure < StandardError; end\n"},
    {when: (operations) => operations.has("probeAcquire"), text: "class ProbeAcquireFailure < StandardError; end\n"},
    {when: (operations) => operations.has("probeRead"), text: "class ProbeReadFailure < StandardError; end\n"},
    {when: (operations) => operations.has("probeClose"), text: "class ProbeCloseFailure < StandardError; end\n"},
    {when: (operations) => operations.has("probeRead") || operations.has("probeClose"), text: "class ProbeResourceClosed < StandardError; end\n"},
    {
      when: resource,
      text: "class ProbeResource\n  attr_accessor :handle, :closed\n  def initialize(handle); @handle = handle; @closed = false; end\nend\n"
    },
    {when: any, text: "$__semantifold_task034_trace = []\n"},
    {
      when: (operations) => operations.has("probeEffect"),
      text: "def probeEffect(label, value, fail_value)\n  $__semantifold_task034_trace << \"effect:#{label}\"\n  raise ProbeOperationFailure, \"ProbeOperationFailure\" if fail_value\n  value\nend\n"
    },
    {
      when: (operations) => operations.has("probeAcquire"),
      text: "def probeAcquire(fail_value)\n  $__semantifold_task034_trace << \"acquire\"\n  raise ProbeAcquireFailure, \"ProbeAcquireFailure\" if fail_value\n  begin; ProbeResource.new(File.open(ENV.fetch(\"SEMANTIFOLD_TASK034_PROBE_PATH\"), \"r\")); rescue ProbeAcquireFailure; raise; rescue StandardError; raise ProbeAcquireFailure, \"ProbeAcquireFailure\"; end\nend\n"
    },
    {
      when: (operations) => operations.has("probeRead"),
      text: "def probeRead(resource, fail_value)\n  raise ProbeResourceClosed, \"ProbeResourceClosed\" if resource.closed\n  $__semantifold_task034_trace << \"read\"\n  raise ProbeReadFailure, \"ProbeReadFailure\" if fail_value\n  begin; value = resource.handle.gets; value.nil? ? nil : value.chomp; rescue ProbeReadFailure; raise; rescue StandardError; raise ProbeReadFailure, \"ProbeReadFailure\"; end\nend\n"
    },
    {
      when: (operations) => operations.has("probeClose"),
      text: "def probeClose(resource, fail_value)\n  raise ProbeResourceClosed, \"ProbeResourceClosed\" if resource.closed\n  $__semantifold_task034_trace << \"close\"\n  begin; resource.handle.close; rescue StandardError; resource.closed = true; raise ProbeCloseFailure, \"ProbeCloseFailure\"; end\n  resource.closed = true\n  raise ProbeCloseFailure, \"ProbeCloseFailure\" if fail_value\n  nil\nend\n"
    },
    {when: (operations) => operations.has("probeTrace"), text: "def probeTrace; $__semantifold_task034_trace.join(\",\"); end\n"}
  ]
  const fs = /** @type {SupportSegment} */ ({when: (operations) => operations.has("probeAcquire"), text: 'const __semantifoldTask034Fs = process.getBuiltinModule("node:fs")\n'})
  const trace = language == "javascript"
    ? {when: any, text: "const __semantifoldTask034Trace = []\n"}
    : {when: any, text: "const __semantifoldTask034Trace: string[] = []\n"}
  const resourceClass = language == "javascript"
    ? {when: resource, text: "class ProbeResource { constructor(handle) { this.handle = handle; this.closed = false; this.position = 0 } }\n"}
    : {when: resource, text: "class ProbeResource { closed = false; position = 0; constructor(readonly handle: number) {} }\n"}

  if (language == "javascript") return [
    fs,
    {when: (operations) => operations.has("probeEffect"), text: "class ProbeOperationFailure extends Error {}\n"},
    {when: (operations) => operations.has("probeAcquire"), text: "class ProbeAcquireFailure extends Error {}\n"},
    {when: (operations) => operations.has("probeRead"), text: "class ProbeReadFailure extends Error {}\n"},
    {when: (operations) => operations.has("probeClose"), text: "class ProbeCloseFailure extends Error {}\n"},
    {when: (operations) => operations.has("probeRead") || operations.has("probeClose"), text: "class ProbeResourceClosed extends Error {}\n"},
    resourceClass,
    trace,
    {
      when: (operations) => operations.has("probeEffect"),
      text: 'function probeEffect(label, value, fail) { __semantifoldTask034Trace.push(`effect:${label}`); if (fail) throw new ProbeOperationFailure("ProbeOperationFailure"); return value }\n'
    },
    {
      when: (operations) => operations.has("probeAcquire"),
      text: 'function probeAcquire(fail) { __semantifoldTask034Trace.push("acquire"); if (fail) throw new ProbeAcquireFailure("ProbeAcquireFailure"); try { return new ProbeResource(__semantifoldTask034Fs.openSync(process.env.SEMANTIFOLD_TASK034_PROBE_PATH, "r")) } catch { throw new ProbeAcquireFailure("ProbeAcquireFailure") } }\n'
    },
    {
      when: (operations) => operations.has("probeRead"),
      text: 'function probeRead(resource, fail) { if (resource.closed) throw new ProbeResourceClosed("ProbeResourceClosed"); __semantifoldTask034Trace.push("read"); if (fail) throw new ProbeReadFailure("ProbeReadFailure"); try { const bytes = []; const buffer = Buffer.alloc(1); while (true) { const count = __semantifoldTask034Fs.readSync(resource.handle, buffer, 0, 1, resource.position++); if (count === 0) return bytes.length === 0 ? null : Buffer.from(bytes).toString("utf8"); if (buffer[0] === 10) return Buffer.from(bytes).toString("utf8").replace(/\\r$/u, ""); bytes.push(buffer[0]) } } catch { throw new ProbeReadFailure("ProbeReadFailure") } }\n'
    },
    {
      when: (operations) => operations.has("probeClose"),
      text: 'function probeClose(resource, fail) { if (resource.closed) throw new ProbeResourceClosed("ProbeResourceClosed"); __semantifoldTask034Trace.push("close"); try { __semantifoldTask034Fs.closeSync(resource.handle) } catch { resource.closed = true; throw new ProbeCloseFailure("ProbeCloseFailure") } resource.closed = true; if (fail) throw new ProbeCloseFailure("ProbeCloseFailure") }\n'
    },
    {when: (operations) => operations.has("probeTrace"), text: 'function probeTrace() { return __semantifoldTask034Trace.join(",") }\n'}
  ]
  return [
    fs,
    {when: (operations) => operations.has("probeEffect"), text: "class ProbeOperationFailure extends Error {}\n"},
    {when: (operations) => operations.has("probeAcquire"), text: "class ProbeAcquireFailure extends Error {}\n"},
    {when: (operations) => operations.has("probeRead"), text: "class ProbeReadFailure extends Error {}\n"},
    {when: (operations) => operations.has("probeClose"), text: "class ProbeCloseFailure extends Error {}\n"},
    {when: (operations) => operations.has("probeRead") || operations.has("probeClose"), text: "class ProbeResourceClosed extends Error {}\n"},
    resourceClass,
    trace,
    {
      when: (operations) => operations.has("probeEffect"),
      text: 'function probeEffect(label: string, value: number, fail: boolean): number { __semantifoldTask034Trace.push(`effect:${label}`); if (fail) throw new ProbeOperationFailure("ProbeOperationFailure"); return value }\n'
    },
    {
      when: (operations) => operations.has("probeAcquire"),
      text: 'function probeAcquire(fail: boolean): ProbeResource { __semantifoldTask034Trace.push("acquire"); if (fail) throw new ProbeAcquireFailure("ProbeAcquireFailure"); try { return new ProbeResource(__semantifoldTask034Fs.openSync(process.env.SEMANTIFOLD_TASK034_PROBE_PATH as string, "r")) } catch { throw new ProbeAcquireFailure("ProbeAcquireFailure") } }\n'
    },
    {
      when: (operations) => operations.has("probeRead"),
      text: 'function probeRead(resource: ProbeResource, fail: boolean): string | null { if (resource.closed) throw new ProbeResourceClosed("ProbeResourceClosed"); __semantifoldTask034Trace.push("read"); if (fail) throw new ProbeReadFailure("ProbeReadFailure"); try { const bytes: number[] = []; const buffer = Buffer.alloc(1); while (true) { const count = __semantifoldTask034Fs.readSync(resource.handle, buffer, 0, 1, resource.position++); if (count === 0) return bytes.length === 0 ? null : Buffer.from(bytes).toString("utf8"); if (buffer[0] === 10) return Buffer.from(bytes).toString("utf8").replace(/\\r$/u, ""); bytes.push(buffer[0]) } } catch { throw new ProbeReadFailure("ProbeReadFailure") } }\n'
    },
    {
      when: (operations) => operations.has("probeClose"),
      text: 'function probeClose(resource: ProbeResource, fail: boolean): void { if (resource.closed) throw new ProbeResourceClosed("ProbeResourceClosed"); __semantifoldTask034Trace.push("close"); try { __semantifoldTask034Fs.closeSync(resource.handle) } catch { resource.closed = true; throw new ProbeCloseFailure("ProbeCloseFailure") } resource.closed = true; if (fail) throw new ProbeCloseFailure("ProbeCloseFailure") }\n'
    },
    {when: (operations) => operations.has("probeTrace"), text: 'function probeTrace(): string { return __semantifoldTask034Trace.join(",") }\n'}
  ]
}

/**
 * Generates the complete tree-shaken stdlib provider artifact content for one adopted target.
 * @param {StdlibProviderTarget} language - Adopted target host provider.
 * @param {readonly string[]} operations - Used canonical operations in contract order.
 * @param {string} [module] - Qualified canonical module identity; omitted for the Task 034 probe.
 * @returns {string} Complete provider source text.
 */
export function generateStdlibProviderContent(language, operations, module) {
  if (module !== undefined && module != "semantifold.task034.resource-probe") {
    if (language != "php") throw new RangeError(`Canonical module '${module}' has no '${language}' provider content.`)
    return generateTask037PhpProviderContent(module, operations)
  }
  const used = new Set(operations)

  if (used.size == 0) throw new Error("A stdlib provider requires at least one used operation.")
  const segments = supportSegments(language)
  const start = language == "ruby" ? "# semantifold-task034-support\n" : "/* semantifold-task034-support */\n"
  const end = language == "ruby" ? "# semantifold-task034-support-end\n\n" : "/* semantifold-task034-support-end */\n\n"
  const support = start +
    segments.filter(({when}) => when(used)).map(({text}) => text).join("") +
    end
  const header = language == "php" ? "<?php\ndeclare(strict_types=1);\n" : ""
  const classExports = language == "javascript" || language == "typescript" ?
    `export {${[
      ["ProbeOperationFailure", used.has("probeEffect")],
      ["ProbeAcquireFailure", used.has("probeAcquire")],
      ["ProbeReadFailure", used.has("probeRead")],
      ["ProbeCloseFailure", used.has("probeClose")],
      ["ProbeResourceClosed", used.has("probeRead") || used.has("probeClose")],
      ["ProbeResource", used.has("probeAcquire") || used.has("probeRead") || used.has("probeClose")]
    ].filter(([, present]) => present).map(([name]) => name).join(", ")}}\n` : ""
  const shims = providerShims(language, operations)

  return header + support + classExports + (shims.length > 0 ? shims.join("\n") + "\n" : "")
}
