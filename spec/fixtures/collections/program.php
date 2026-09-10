<?php
declare(strict_types=1);

/**
 * @param list<int> $values
 * @return list<int>
 */
function pass_list(array $values): array {
    return $values;
}

/**
 * @param array<string,int> $values
 * @return array<string,int>
 */
function pass_map(array $values): array {
    return $values;
}

/** @var list<int> $numbers */
$numbers = [4, 4, 7];
/** @var array<string,int> $values */
$values = ["answer" => 42];
/** @var list<int> $emptyNumbers */
$emptyNumbers = [];
/** @var array<string,int> $emptyValues */
$emptyValues = [];
/** @var list<list<int>> $nested */
$nested = [[1, 2], [3]];
echo $numbers[0], PHP_EOL;
echo $numbers[1], PHP_EOL;
echo $numbers[2], PHP_EOL;
echo $values["answer"], PHP_EOL;
echo count($numbers), PHP_EOL;
echo count($values), PHP_EOL;
echo $nested[1][0], PHP_EOL;
echo count(pass_list($numbers)), PHP_EOL;
echo count(pass_map($values)), PHP_EOL;
