public final class Main {
  private static java.util.Optional<String> maybe(String value, boolean present) {
    if (present) {
      return java.util.Optional.of(value);
    } else {
      return java.util.Optional.empty();
    }
  }

  private static String label(java.util.Optional<String> value) {
    if (value.isPresent()) {
      return value.get();
    } else {
      return "absent";
    }
  }

  public static void main(String[] args) {
    final java.util.Optional<String> presentValue = maybe("present", true);
    final java.util.Optional<String> absentValue = maybe("ignored", false);
    System.out.println(label(presentValue));
    System.out.println(label(absentValue));
  }
}
