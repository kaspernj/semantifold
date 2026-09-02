// @ts-check

/**
 * Converts a source offset to a one-based point.
 * @param {string} source - Complete source.
 * @param {number} offset - Zero-based UTF-16 offset.
 * @returns {import("./types.js").SourcePoint} Source point.
 */
export function pointAt(source, offset) {
  if (!Number.isInteger(offset) || offset < 0 || offset > source.length) {
    throw new RangeError(`Invalid source offset: ${offset}`)
  }

  let line = 1
  let lineStart = 0

  for (let index = 0; index < offset; index++) {
    if (source[index] == "\n") {
      line++
      lineStart = index + 1
    }
  }

  return {column: offset - lineStart + 1, line, offset}
}

/**
 * Builds a normalized source location from offsets.
 * @param {string} filename - Originating filename.
 * @param {string} source - Complete source.
 * @param {number} startOffset - Inclusive start offset.
 * @param {number} endOffset - Exclusive end offset.
 * @returns {import("./types.js").SourceLocation} Source location.
 */
export function locationFromOffsets(filename, source, startOffset, endOffset) {
  return {
    filename,
    start: pointAt(source, startOffset),
    end: pointAt(source, endOffset)
  }
}

/**
 * Builds a location spanning a complete source file.
 * @param {string} filename - Originating filename.
 * @param {string} source - Complete source.
 * @returns {import("./types.js").SourceLocation} Source location.
 */
export function moduleLocation(filename, source) {
  return locationFromOffsets(filename, source, 0, source.length)
}
