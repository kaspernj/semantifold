<?php
declare(strict_types=1);

function label(bool $flag, string $fallback): string
{
    if ($flag) {
        return 'yes';
    } else {
        return $fallback;
    }
}

echo label(true, 'no'), PHP_EOL;
