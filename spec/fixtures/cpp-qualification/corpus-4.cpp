#include <cstdint>
std::int64_t compute(std::int64_t a, std::int64_t b) { std::int64_t result = (a + b) * (a - b); result = -result; if (a <= b) { if (a >= b) { return a; } } else { if (a > b) { return b; } } return result; }
