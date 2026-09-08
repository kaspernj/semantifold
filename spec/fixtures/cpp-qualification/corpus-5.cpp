#include <cstdint>
std::int64_t first(std::int64_t a, std::int64_t b) { return a; }
std::int64_t second(std::int64_t a, std::int64_t b) { return first(a, b); }
int main() { semantifold_print_integer(second(1, 2)); return 0; }
