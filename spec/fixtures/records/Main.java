final class Address {
  private final String city;
  private final int zip;

  Address(String city, int zip) {
    this.city = city;
    this.zip = zip;
  }

  String city() {
    return this.city;
  }

  int zip() {
    return this.zip;
  }
}

final class User {
  private final String name;
  private final Address address;
  private final java.util.List<String> tags;
  private final java.util.Map<String,String> attributes;
  private final java.util.Optional<String> nickname;

  User(String name, Address address, java.util.List<String> tags, java.util.Map<String,String> attributes, java.util.Optional<String> nickname) {
    this.name = name;
    this.address = address;
    this.tags = tags;
    this.attributes = attributes;
    this.nickname = nickname;
  }

  String name() {
    return this.name;
  }

  Address address() {
    return this.address;
  }

  java.util.List<String> tags() {
    return this.tags;
  }

  java.util.Map<String,String> attributes() {
    return this.attributes;
  }

  java.util.Optional<String> nickname() {
    return this.nickname;
  }
}

public final class Main {
  private static User pass(User user) {
    return user;
  }

  public static void main(String[] args) {
    final Address address = new Address("Paris", 75000);
    final User user = new User("Ada", address, java.util.List.of("admin", "coder"), java.util.Map.of("role", "editor"), java.util.Optional.empty());
    System.out.println(address.city());
    System.out.println(pass(user).address().zip());
    System.out.println(user.tags().size());
    System.out.println(user.attributes().size());
    System.out.println(user.name());
  }
}
