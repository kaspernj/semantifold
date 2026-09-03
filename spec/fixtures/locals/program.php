<?php
declare(strict_types=1);

function select(bool $flag, string $fallback): string
{
    /**
     * @var string $preferred
     * @semantifold-immutable
     */
    $preferred = "yes";
    /** @var string $result */
    $result = $fallback;
    if ($flag) {
        $result = $preferred;
        return $result;
    } else {
        return $result;
    }
}

/** @var string $output */
$output = "no";
$output = select(true, $output);
echo $output, PHP_EOL;
