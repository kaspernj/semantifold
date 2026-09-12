<?php
declare(strict_types=1);

final class ValidationError extends RuntimeException {}
final class ProcessingError extends RuntimeException {}

function describe(int $mode): string
{
    try {
        try {
            if ($mode === 0) {
                return "ok";
            }
            if ($mode === 1) {
                throw new ValidationError("bad");
            }
            throw new ProcessingError("deep");
        } catch (ValidationError $innerError) {
            return $innerError->getMessage();
        }
    } catch (ProcessingError $outerError) {
        return $outerError->getMessage();
    }
}

echo describe(0), PHP_EOL;
echo describe(1), PHP_EOL;
echo describe(2), PHP_EOL;
