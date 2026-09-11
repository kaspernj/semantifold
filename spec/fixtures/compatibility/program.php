<?php
declare(strict_types=1);

function zero(): int
{
    return 0;
}

function identityText(string $value): string
{
    return $value;
}

function sumThree(int $first, int $second, int $third): int
{
    return $first + $second + $third;
}

function countdown(int $value): int
{
    if ($value > 0) {
        return countdown($value - 1);
    }
    return $value;
}

function announce(string $value): void
{
    echo $value, PHP_EOL;
}

function noop(): void
{
    return;
}

function maybe(string $value, bool $present): ?string
{
    if ($present) {
        return $value;
    } else {
        return null;
    }
}

function optionalLabel(?string $value): string
{
    if ($value !== null) {
        return $value;
    } else {
        return "absent";
    }
}

function branchLabel(int $value, bool $enabled, string $prefix): string
{
    /** @var int $total */
    $total = $value + zero();
    $total = $total * 2;
    /**
     * @var int $threshold
     * @semantifold-immutable
     */
    $threshold = 5;
    /** @var string $label */
    $label = $prefix . "fallback";
    if ($enabled && $total > $threshold) {
        $label = $prefix . "ok";
        if ($total !== $threshold && (!$enabled || $enabled)) {
            $label = $label . "!";
        }
    } else {
        $label = $label . "!";
    }
    return $label;
}

/** @param list<int> $values */
function orderedTotal(array $values): int
{
    /** @var int $total */
    $total = 0;
    foreach ($values as $item) {
        if ($item < 5) {
            if ($item === 2) {
                continue;
            }
            $total = $total + $item;
        } else {
            if ($item === 5) {
                break;
            }
        }
    }
    return $total;
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
/**
 * @var list<int> $values
 * @semantifold-immutable
 */
$values = [1, 2, 3, 5, 8];
/**
 * @var array<string,list<int>> $groups
 * @semantifold-immutable
 */
$groups = ["main" => [7, 8], "spare" => [9]];
/**
 * @var list<list<int>> $nested
 * @semantifold-immutable
 */
$nested = [[1, 2], [3]];
announce(identityText("compat"));
noop();
echo branchLabel(sumThree(countdown(1), 1, 2), true, "branch-"), PHP_EOL;
echo optionalLabel($presentValue), PHP_EOL;
echo optionalLabel($absentValue), PHP_EOL;
echo $groups["main"][0], PHP_EOL;
echo count($groups), PHP_EOL;
echo $nested[1][0], PHP_EOL;
echo count($values), PHP_EOL;
echo orderedTotal($values), PHP_EOL;
