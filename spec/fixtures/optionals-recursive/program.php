<?php
declare(strict_types=1);

function label(?string $value): string
{
    if ($value !== null) {
        return $value;
    } else {
        return "absent";
    }
}

/** @var list<?string> $values */
$values = ["list-present", null];
/** @var array<string,?string> $byName */
$byName = ["present" => "map-present", "absent" => null];
echo label($values[0]), PHP_EOL;
echo label($values[1]), PHP_EOL;
echo label($byName["present"]), PHP_EOL;
echo label($byName["absent"]), PHP_EOL;
