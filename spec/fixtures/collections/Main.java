public final class Main {
  private static java.util.List<Integer> passList(java.util.List<Integer> values) {
    return values;
  }

  private static java.util.Map<String,Integer> passMap(java.util.Map<String,Integer> values) {
    return values;
  }

  public static void main(String[] args) {
    final java.util.List<Integer> numbers = java.util.List.of(4, 4, 7);
    final java.util.Map<String,Integer> values = java.util.Map.of("answer", 42);
    final java.util.List<Integer> emptyNumbers = java.util.List.of();
    final java.util.Map<String,Integer> emptyValues = java.util.Map.of();
    final java.util.List<java.util.List<Integer>> nested = java.util.List.of(java.util.List.of(1, 2), java.util.List.of(3));
    System.out.println(numbers.get(0));
    System.out.println(numbers.get(1));
    System.out.println(numbers.get(2));
    System.out.println(values.get("answer"));
    System.out.println(numbers.size());
    System.out.println(values.size());
    System.out.println(nested.get(1).get(0));
    System.out.println(passList(numbers).size());
    System.out.println(passMap(values).size());
  }
}
