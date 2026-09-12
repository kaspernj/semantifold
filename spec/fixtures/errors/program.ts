class ValidationError extends Error {}
class ProcessingError extends Error {}

function describe(mode: number): string {
  try {
    try {
      if (mode === 0) return "ok"
      if (mode === 1) throw new ValidationError("bad")
      throw new ProcessingError("deep")
    } catch (innerError) {
      if (!(innerError instanceof ValidationError)) {
        throw innerError
      }
      return innerError.message
    }
  } catch (outerError) {
    if (!(outerError instanceof ProcessingError)) {
      throw outerError
    }
    return outerError.message
  }
}

console.log(describe(0))
console.log(describe(1))
console.log(describe(2))
