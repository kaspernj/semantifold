#include <string>
/* 😀 */
std::string join(std::string a, std::string b) { const std::string copied = a; std::string text = "é\000🌍"; text = copied + b; return text; }
