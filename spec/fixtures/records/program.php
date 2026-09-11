<?php
declare(strict_types=1);

final readonly class Address {
    public function __construct(public string $city, public int $zip) {}
}

final readonly class User {
    /**
     * @param list<string> $tags
     * @param array<string,string> $attributes
     */
    public function __construct(
        public string $name,
        public Address $address,
        public array $tags,
        public array $attributes,
        public ?string $nickname
    ) {}
}

function pass(User $user): User {
    return $user;
}

$address = new Address("Paris", 75000);
$user = new User("Ada", $address, ["admin", "coder"], ["role" => "editor"], null);
echo $address->city, PHP_EOL;
echo pass($user)->address->zip, PHP_EOL;
echo count($user->tags), PHP_EOL;
echo count($user->attributes), PHP_EOL;
echo $user->name, PHP_EOL;
