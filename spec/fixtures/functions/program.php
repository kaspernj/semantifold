<?php
declare(strict_types=1);

function zero(): int {
    return 0;
}

function passText(string $value): string {
    return $value;
}

function sum3(int $first, int $second, int $third): int {
    return $first + $second + $third;
}

function countdown(int $value): int {
    if ($value > 0) {
        return countdown($value - 1);
    }
    return $value;
}

function announce(string $value): void {
    echo $value, PHP_EOL;
}

function noop(): void {
    return;
}

function nested(int $first, int $second, int $third): int {
    return sum3(zero(), sum3($first, $second, $third), countdown(2));
}

announce(passText("ready"));
noop();
echo nested(1, 2, 3), PHP_EOL;
