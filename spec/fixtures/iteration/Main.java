public final class Main {
  private static java.util.List<Integer> passList(java.util.List<Integer> values) {
    return values;
  }

  private static int orderedTotal(java.util.List<Integer> values) {
    int total = 0;
    for (Integer value : passList(values)) {
      if (value < 5) {
        if (value == 2) {
          continue;
        }
        total = total + value;
      } else {
        if (value == 5) {
          break;
        }
      }
    }
    return total;
  }

  public static void main(String[] args) {
    final java.util.List<Integer> values = java.util.List.of(1, 2, 3, 5, 8);
    System.out.println(orderedTotal(values));
  }
}
