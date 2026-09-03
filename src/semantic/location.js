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
    if (source[index] == "\r") {
      if (source[index + 1] == "\n") {
        if (index + 1 < offset) {
          line++
          index++
          lineStart = index + 1
        }
      } else {
        line++
        lineStart = index + 1
      }
    } else if (source[index] == "\n") {
      line++
      lineStart = index + 1
    }
  }

  return {column: offset - lineStart + 1, line, offset}
}

/**
 * Builds a reusable UTF-16 line index in one pass.
 * @param {string} source - Complete source.
 * @returns {{source: string, lineStarts: number[]}} Coordinate index.
 */
export function createCoordinateIndex(source) {
  const lineStarts = [0]

  for (let index = 0; index < source.length; index++) {
    if (source[index] == "\r") {
      if (source[index + 1] == "\n") index++
      lineStarts.push(index + 1)
    } else if (source[index] == "\n") lineStarts.push(index + 1)
  }

  return {lineStarts, source}
}

/**
 * Converts an offset with a reusable coordinate index.
 * @param {{source: string, lineStarts: number[]}} index - Coordinate index.
 * @param {number} offset - Zero-based UTF-16 offset.
 * @returns {import("./types.js").SourcePoint} Source point.
 */
export function indexedPointAt(index, offset) {
  const {lineStarts, source} = index

  if (!Number.isInteger(offset) || offset < 0 || offset > source.length) {
    throw new RangeError(`Invalid source offset: ${offset}`)
  }

  let low = 0
  let high = lineStarts.length

  while (low < high) {
    const middle = Math.floor((low + high) / 2)

    if (lineStarts[middle] <= offset) low = middle + 1
    else high = middle
  }
  const lineIndex = low - 1

  return {column: offset - lineStarts[lineIndex] + 1, line: lineIndex + 1, offset}
}

/**
 * Converts a canonical one-based UTF-16 line/column pair to its unique offset.
 * @param {{source: string, lineStarts: number[]}} index - Coordinate index.
 * @param {number} line - One-based line.
 * @param {number} column - One-based UTF-16 column.
 * @returns {number} Source offset.
 */
export function indexedOffsetAt(index, line, column) {
  if (!Number.isInteger(line) || line < 1 || line > index.lineStarts.length || !Number.isInteger(column) || column < 1) {
    throw new RangeError(`Invalid source position ${line}:${column}.`)
  }
  const offset = index.lineStarts[line - 1] + column - 1
  const point = indexedPointAt(index, offset)

  if (point.line != line || point.column != column) throw new RangeError(`Invalid source position ${line}:${column}.`)

  return offset
}

/**
 * Converts a parser UTF-8 byte offset to Semantifold's UTF-16 source offset.
 * @param {string} source - Complete source.
 * @param {number} byteOffset - Zero-based UTF-8 byte offset.
 * @returns {number} Zero-based UTF-16 offset.
 */
export function utf8ByteOffsetToUtf16Offset(source, byteOffset) {
  if (!Number.isInteger(byteOffset) || byteOffset < 0) throw new RangeError(`Invalid UTF-8 source offset: ${byteOffset}`)

  let bytes = 0

  for (let index = 0; index < source.length;) {
    if (bytes == byteOffset) return index

    const codePoint = source.codePointAt(index)

    if (codePoint === undefined) throw new RangeError(`Invalid UTF-8 source offset: ${byteOffset}`)

    bytes += codePoint <= 0x7F ? 1 : codePoint <= 0x7FF ? 2 : codePoint <= 0xFFFF ? 3 : 4
    if (bytes > byteOffset) throw new RangeError(`Invalid UTF-8 source offset: ${byteOffset}`)
    index += codePoint > 0xFFFF ? 2 : 1
  }

  if (bytes == byteOffset) return source.length

  throw new RangeError(`Invalid UTF-8 source offset: ${byteOffset}`)
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
