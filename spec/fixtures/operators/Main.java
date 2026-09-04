public final class Main {
  private static int arithmetic(int left, int right) {
    if ((left < right) && !(left == right)) {
      return -left + right * 2;
    } else {
      return left - right;
    }
  }

  private static boolean ordered(int left, int right) {
    if ((left <= right || left >= right) && left != right) {
      return left > right;
    } else {
      return left < right;
    }
  }

  private static boolean logic(boolean left, boolean right) {
    if ((!left || right) && left != right) {
      return left == right;
    } else {
      return left || right;
    }
  }

  private static String combine(String left, String right) {
    if (left.equals(right) || !left.equals(right)) {
      return left + ":" + right;
    } else {
      return left + right;
    }
  }

  private static String report(int left, int right) {
    if ((arithmetic(left, right) == 17 && ordered(right, left)) && !logic(false, true)) {
      return combine("typed", "operators");
    } else {
      return "bad";
    }
  }

  public static void main(String[] args) {
    System.out.println(report(3, 10));
  }
}
