final class ValidationError extends RuntimeException {
  ValidationError(String message) {
    super(message);
  }
}

final class ProcessingError extends RuntimeException {
  ProcessingError(String message) {
    super(message);
  }
}

public final class Main {
  private static String describe(int mode) {
    try {
      try {
        if (mode == 0) {
          return "ok";
        }
        if (mode == 1) {
          throw new ValidationError("bad");
        }
        throw new ProcessingError("deep");
      } catch (ValidationError innerError) {
        return innerError.getMessage();
      }
    } catch (ProcessingError outerError) {
      return outerError.getMessage();
    }
  }

  public static void main(String[] args) {
    System.out.println(describe(0));
    System.out.println(describe(1));
    System.out.println(describe(2));
  }
}
