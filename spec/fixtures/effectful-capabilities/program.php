<?php
declare(strict_types=1);

function consume(ProbeResource $resource): void {
    probeClose($resource, false);
}

/**
 * @var ProbeResource $resource
 * @semantifold-immutable
 */
$resource = probeAcquire(false);
consume($resource);
echo probeTrace(), PHP_EOL;
