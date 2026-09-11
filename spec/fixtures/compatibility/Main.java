public final class Main {
  private static int zero() {
    return 0;
  }

  private static String identityText(String value) {
    return value;
  }

  private static int sumThree(int first, int second, int third) {
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

  private static java.util.Optional<String> maybe(String value, boolean present) {
    if (present) {
      return java.util.Optional.of(value);
    } else {
      return java.util.Optional.empty();
    }
  }

  private static String optionalLabel(java.util.Optional<String> value) {
    if (value.isPresent()) {
      return value.get();
    } else {
      return "absent";
    }
  }

  private static String branchLabel(int value, boolean enabled, String prefix) {
    int total = value + zero();
    total = total * 2;
    final int threshold = 5;
    String label = prefix + "fallback";
    if (enabled && total > threshold) {
      label = prefix + "ok";
      if (total != threshold && (!enabled || enabled)) {
        label = label + "!";
      }
    } else {
      label = label + "!";
    }
    return label;
  }

  private static int orderedTotal(java.util.List<Integer> values) {
    int total = 0;
    for (Integer item : values) {
      if (item < 5) {
        if (item == 2) {
          continue;
        }
        total = total + item;
      } else {
        if (item == 5) {
          break;
        }
      }
    }
    return total;
  }

  public static void main(String[] args) {
    final java.util.Optional<String> presentValue = maybe("present", true);
    final java.util.Optional<String> absentValue = maybe("ignored", false);
    final java.util.List<Integer> values = java.util.List.of(1, 2, 3, 5, 8);
    final java.util.Map<String,java.util.List<Integer>> groups = java.util.Map.of("main", java.util.List.of(7, 8), "spare", java.util.List.of(9));
    final java.util.List<java.util.List<Integer>> nested = java.util.List.of(java.util.List.of(1, 2), java.util.List.of(3));
    announce(identityText("compat"));
    noop();
    System.out.println(branchLabel(sumThree(countdown(1), 1, 2), true, "branch-"));
    System.out.println(optionalLabel(presentValue));
    System.out.println(optionalLabel(absentValue));
    System.out.println(groups.get("main").get(0));
    System.out.println(groups.size());
    System.out.println(nested.get(1).get(0));
    System.out.println(values.size());
    System.out.println(orderedTotal(values));
  }
}
