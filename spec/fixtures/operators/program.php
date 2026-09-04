<?php
declare(strict_types=1);

function arithmetic(int $left, int $right): int
{
    if (($left < $right) && !($left === $right)) {
        return -$left + $right * 2;
    } else {
        return $left - $right;
    }
}

function ordered(int $left, int $right): bool
{
    if (($left <= $right || $left >= $right) && $left !== $right) {
        return $left > $right;
    } else {
        return $left < $right;
    }
}

function logic(bool $left, bool $right): bool
{
    if ((!$left || $right) && $left !== $right) {
        return $left === $right;
    } else {
        return $left || $right;
    }
}

function combine(string $left, string $right): string
{
    if ($left === $right || $left !== $right) {
        return $left . ":" . $right;
    } else {
        return $left . $right;
    }
}

function report(int $left, int $right): string
{
    if ((arithmetic($left, $right) === 17 && ordered($right, $left)) && !logic(false, true)) {
        return combine("typed", "operators");
    } else {
        return "bad";
    }
}

echo report(3, 10), PHP_EOL;
