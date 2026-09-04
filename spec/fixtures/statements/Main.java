public final class Main {
  private static String select(boolean flag, String fallback) {
    String result = fallback;
    if (flag) {
      result = "yes";
      System.out.println("checking");
      if (fallback.equals("alt")) {
        return fallback;
      } else if (fallback.equals("no")) {
        return result;
      } else {
        return "other";
      }
    }
    return result;
  }

  public static void main(String[] args) {
    String output = select(true, "no");
    System.out.println(output);
    if (output.equals("yes")) {
      System.out.println("matched");
    }
    output = select(false, "fallback");
    System.out.println(output);
  }
}
