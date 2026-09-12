<?php
declare(strict_types=1);

function identity(int $value): int {
    return $value;
}

/** @var array<string,int> $values */
$values = ["b" => 2, "a" => 1, "c" => 3];
echo count($values), PHP_EOL;
echo $values["b"], PHP_EOL;
foreach ($values as $key => $value) {
    if ($key === "a") {
        continue;
    }
    echo $key, PHP_EOL;
    echo identity($value), PHP_EOL;
    if ($key === "c") {
        break;
    }
}
