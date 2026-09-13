public final class Main {
  private static void consume(ProbeResource resource) {
    probeClose(resource, false);
  }

  public static void main(String[] args) {
    final ProbeResource resource = probeAcquire(false);
    consume(resource);
    System.out.println(probeTrace());
  }
}
