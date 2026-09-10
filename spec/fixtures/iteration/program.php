<?php
declare(strict_types=1);

/**
 * @param list<int> $values
 * @return list<int>
 */
function pass_list(array $values): array {
    return $values;
}

/**
 * @param list<int> $values
 */
function ordered_total(array $values): int {
    /** @var int $total */
    $total = 0;
    foreach (pass_list($values) as $value) {
        if ($value < 5) {
            if ($value === 2) {
                continue;
            }
            $total = $total + $value;
        } else {
            if ($value === 5) {
                break;
            }
        }
    }
    return $total;
}

/** @var list<int> $values */
$values = [1, 2, 3, 5, 8];
echo ordered_total($values), PHP_EOL;
