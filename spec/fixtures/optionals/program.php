<?php
declare(strict_types=1);

function maybe(string $value, bool $present): ?string
{
    if ($present) {
        return $value;
    } else {
        return null;
    }
}

function label(?string $value): string
{
    if ($value !== null) {
        return $value;
    } else {
        return "absent";
    }
}

/**
 * @var ?string $presentValue
 * @semantifold-immutable
 */
$presentValue = maybe("present", true);
/**
 * @var ?string $absentValue
 * @semantifold-immutable
 */
$absentValue = maybe("ignored", false);
echo label($presentValue), PHP_EOL;
echo label($absentValue), PHP_EOL;
