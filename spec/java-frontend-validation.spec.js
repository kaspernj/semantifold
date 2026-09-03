// @ts-check

import assert from "node:assert/strict"
import {describe, it} from "@velocious/testing"
import {parse, SemantifoldDiagnostic} from "../index.js"

/**
 * Asserts a Java diagnostic.
 * @param {string} source - Java source.
 * @param {string} [code] - Expected diagnostic code.
 * @returns {void}
 */
function assertUnsupported(source, code = "UNSUPPORTED_SYNTAX") {
  assert.throws(
    () => parse({filename: "Main.java", language: "java", source}),
    (error) => error instanceof SemantifoldDiagnostic && error.code == code && error.language == "java" && error.location?.filename == "Main.java"
  )
}

describe("Java frontend validation", () => {
  it("rejects method invocations with an unmodeled receiver", () => {
    assertUnsupported(`
public final class Main {
  private static int difference(int left, int right) {
    if (left > right) {
      return Math.max(left, right);
    } else {
      return right - left;
    }
  }
  public static void main(String[] args) {
    System.out.println(difference(4, 9));
  }
}
`)
  })

  it("rejects unsupported invocation arguments instead of filtering them", () => {
    assertUnsupported(`
public final class Main {
  private static int difference(int left, int right) {
    if (left > right) {
      return left - right;
    } else {
      return right - left;
    }
  }
  public static void main(String[] args) {
    System.out.println(difference("4", 9));
  }
}
`, "TYPE_MISMATCH")
  })

  it("rejects extra entry-point statements instead of ignoring them", () => {
    assertUnsupported(`
public final class Main {
  private static int difference(int left, int right) {
    if (left > right) {
      return left - right;
    } else {
      return right - left;
    }
  }
  public static void main(String[] args) {
    int first = 1, second = 2;
    System.out.println(difference(4, 9));
  }
}
`)
  })
})
