public final class Main {
  private static int identity(int value) {
    return value;
  }

  public static void main(String[] args) {
    final java.util.LinkedHashMap<String,Integer> valuesBacking = new java.util.LinkedHashMap<>();
    valuesBacking.put("b", 2);
    valuesBacking.put("a", 1);
    valuesBacking.put("c", 3);
    final java.util.SequencedMap<String,Integer> values = java.util.Collections.unmodifiableSequencedMap(valuesBacking);
    System.out.println(values.size());
    System.out.println(values.get("b"));
    for (java.util.Map.Entry<String,Integer> valuesEntry : values.sequencedEntrySet()) {
      final String key = valuesEntry.getKey();
      final int value = valuesEntry.getValue();
      if (key.equals("a")) {
        continue;
      }
      System.out.println(key);
      System.out.println(identity(value));
      if (key.equals("c")) {
        break;
      }
    }
  }
}
