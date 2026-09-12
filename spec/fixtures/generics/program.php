<?php
declare(strict_types=1);

/**
 * @template T
 */
final class Batch {
    /**
     * @param list<T> $values
     */
    public function __construct(private array $values) {}

    /**
     * @return list<T>
     */
    public function values(): array {
        return $this->values;
    }
}

/**
 * @template T
 */
final class Box {
    /**
     * @param T $value
     */
    public function __construct(private $value) {}

    /**
     * @return T
     */
    public function value() {
        return $this->value;
    }
}

/**
 * @template T
 * @param T $value
 * @return T
 */
function identity($value) {
    return $value;
}

/**
 * @template T
 * @param Batch<T> $batch
 * @return Batch<T>
 */
function passthrough(Batch $batch): Batch {
    return $batch;
}

/**
 * @template T
 * @template U
 * @param T $left
 * @param U $_right
 * @return T
 */
function choose($left, $_right) {
    return $left;
}

/**
 * @template T
 * @param T $left
 * @param T $_right
 * @return T
 */
function same($left, $_right) {
    return $left;
}

/** @var Batch<string> $batch
 * @semantifold-immutable
 */
$batch = new Batch(["first", "second"]);
/** @var Box<string> $box
 * @semantifold-immutable
 */
$box = new Box("ready");
echo identity($box)->value(), PHP_EOL;
echo count(passthrough($batch)->values()), PHP_EOL;
echo choose("left", 1), PHP_EOL;
echo same(2, 3), PHP_EOL;
