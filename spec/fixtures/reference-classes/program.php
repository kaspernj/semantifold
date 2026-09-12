<?php
declare(strict_types=1);

final class Counter {
    private int $value;

    public function __construct(int $value) {
        $this->value = $value;
    }

    public function add(int $delta): void {
        $this->value = $this->value + $delta;
    }

    public function next(): int {
        $this->value = $this->value + 1;
        return $this->value;
    }

    public function current(): int {
        return $this->value;
    }

    public function combine(int $first, int $second): int {
        return $this->value * 100 + $first * 10 + $second;
    }
}

final class Pair {
    private int $left;
    private int $right;

    public function __construct(int $left, int $right) {
        $this->left = $left;
        $this->right = $right;
    }

    public function code(): int {
        return $this->left * 100 + $this->right;
    }
}

function choose(Counter $marker, Counter $target): Counter {
    $marker->add(10);
    return $target;
}

$first = new Counter(1);
$second = new Counter(5);
$alias_value = $first;
$alias_value->add(2);
echo $first->current(), PHP_EOL;
echo $second->current(), PHP_EOL;
$marker = new Counter(0);
$target = new Counter(1);
echo choose($marker, $target)->combine($marker->next(), $marker->next()), PHP_EOL;
$pair = new Pair($marker->next(), $marker->next());
echo $pair->code(), PHP_EOL;
