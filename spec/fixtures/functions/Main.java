public final class Main {
  private static int zero() {
    return 0;
  }

  private static String passText(String value) {
    return value;
  }

  private static int sum3(int first, int second, int third) {
    return first + second + third;
  }

  private static int countdown(int value) {
    if (value > 0) {
      return countdown(value - 1);
    }
    return value;
  }

  private static void announce(String value) {
    System.out.println(value);
  }

  private static void noop() {
    return;
  }

  private static int nested(int first, int second, int third) {
    return sum3(zero(), sum3(first, second, third), countdown(2));
  }

  public static void main(String[] args) {
    announce(passText("ready"));
    noop();
    System.out.println(nested(1, 2, 3));
  }
}
