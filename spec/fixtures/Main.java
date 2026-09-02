public final class Main {
  private static int difference(int left, int right) {
    if (left > right) {
      return left - right;
    } else {
      return right - left;
    }
  }

  public static void main(String[] args) {
    System.out.println(difference(4, 9));
  }
}
