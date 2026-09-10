public final class Main {
  private static String label(java.util.Optional<String> value) {
    if (value.isPresent()) {
      return value.get();
    } else {
      return "absent";
    }
  }

  public static void main(String[] args) {
    final java.util.List<java.util.Optional<String>> values = java.util.List.of(
      java.util.Optional.of("list-present"),
      java.util.Optional.empty()
    );
    final java.util.Map<String,java.util.Optional<String>> byName = java.util.Map.of(
      "present", java.util.Optional.of("map-present"),
      "absent", java.util.Optional.empty()
    );
    System.out.println(label(values.get(0)));
    System.out.println(label(values.get(1)));
    System.out.println(label(byName.get("present")));
    System.out.println(label(byName.get("absent")));
  }
}
