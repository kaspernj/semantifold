public final class Main {
  private static String select(boolean flag, String fallback) {
    final String preferred = "yes";
    String result = fallback;
    if (flag) {
      result = preferred;
      return result;
    } else {
      return result;
    }
  }

  public static void main(String[] args) {
    String output = "no";
    output = select(true, output);
    System.out.println(output);
  }
}
