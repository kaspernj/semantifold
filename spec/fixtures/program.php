<?php
declare(strict_types=1);

function difference(int $left, int $right): int
{
    if ($left > $right) {
        return $left - $right;
    } else {
        return $right - $left;
    }
}

echo difference(4, 9), PHP_EOL;
