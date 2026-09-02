public final class Main {
  private static java.lang.String label(boolean flag, String fallback) {
    if (flag) {
      return "yes";
    } else {
      return fallback;
    }
  }

  public static void main(String[] args) {
    System.out.println(label(true, "no"));
  }
}
