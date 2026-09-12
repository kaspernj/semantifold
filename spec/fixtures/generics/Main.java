final class Batch<T> {
  private final java.util.List<T> values;

  Batch(java.util.List<T> values) {
    this.values = values;
  }

  java.util.List<T> values() {
    return this.values;
  }
}

final class Box<T> {
  private final T value;

  Box(T value) {
    this.value = value;
  }

  T value() {
    return this.value;
  }
}

public final class Main {
  private static <T> T identity(T value) {
    return value;
  }

  private static <T> Batch<T> passthrough(Batch<T> batch) {
    return batch;
  }

  private static <T, U> T choose(T left, U _right) {
    return left;
  }

  private static <T> T same(T left, T _right) {
    return left;
  }

  public static void main(String[] args) {
    final Batch<String> batch = new Batch<String>(java.util.List.of("first", "second"));
    final Box<String> box = new Box<String>("ready");
    System.out.println(identity(box).value());
    System.out.println(passthrough(batch).values().size());
    System.out.println(choose("left", 1));
    System.out.println(same(2, 3));
  }
}
