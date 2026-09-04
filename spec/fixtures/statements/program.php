<?php
declare(strict_types=1);

function select(bool $flag, string $fallback): string
{
    /** @var string $result */
    $result = $fallback;
    if ($flag) {
        $result = "yes";
        echo "checking", PHP_EOL;
        if ($fallback === "alt") {
            return $fallback;
        } elseif ($fallback === "no") {
            return $result;
        } else {
            return "other";
        }
    }
    return $result;
}

/** @var string $output */
$output = select(true, "no");
echo $output, PHP_EOL;
if ($output === "yes") {
    echo "matched", PHP_EOL;
}
$output = select(false, "fallback");
echo $output, PHP_EOL;
