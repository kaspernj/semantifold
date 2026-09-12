final class Counter {
  private int value;

  Counter(int value) {
    this.value = value;
  }

  void add(int delta) {
    this.value = this.value + delta;
  }

  int next() {
    this.value = this.value + 1;
    return this.value;
  }

  int current() {
    return this.value;
  }

  int combine(int first, int second) {
    return this.value * 100 + first * 10 + second;
  }
}

final class Pair {
  private int left;
  private int right;

  Pair(int left, int right) {
    this.left = left;
    this.right = right;
  }

  int code() {
    return this.left * 100 + this.right;
  }
}

public final class Main {
  private static Counter choose(Counter marker, Counter target) {
    marker.add(10);
    return target;
  }

  public static void main(String[] args) {
    final Counter first = new Counter(1);
    final Counter second = new Counter(5);
    final Counter alias_value = first;
    alias_value.add(2);
    System.out.println(first.current());
    System.out.println(second.current());
    final Counter marker = new Counter(0);
    final Counter target = new Counter(1);
    System.out.println(choose(marker, target).combine(marker.next(), marker.next()));
    final Pair pair = new Pair(marker.next(), marker.next());
    System.out.println(pair.code());
  }
}
