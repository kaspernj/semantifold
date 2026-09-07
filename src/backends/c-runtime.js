// @ts-check

/** Canonical C17 support header; native ownership never enters semantic IR. */
export const cRuntimeHeader = `#ifndef SEMANTIFOLD_RUNTIME_H
#define SEMANTIFOLD_RUNTIME_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

_Static_assert(CHAR_BIT == 8, "Semantifold requires eight-bit bytes");
_Static_assert(sizeof(int64_t) == 8, "Semantifold requires exact int64_t");
_Static_assert(sizeof(size_t) == 8 && PTRDIFF_MAX == INT64_MAX, "Semantifold requires the qualified 64-bit ABI");

typedef struct {
    const unsigned char *data;
    size_t length;
} SemantifoldString;

#define SEMANTIFOLD_STRING(literal) ((SemantifoldString){(const unsigned char *)(literal), sizeof(literal) - 1})

typedef struct SemantifoldAllocation {
    struct SemantifoldAllocation *next;
    unsigned char data[];
} SemantifoldAllocation;

_Static_assert(sizeof(SemantifoldAllocation) == 8, "Semantifold requires the qualified arena metadata size");

static SemantifoldAllocation *semantifold_arena = NULL;
static size_t semantifold_arena_bytes = 0;

static inline void semantifold_cleanup(void) {
    while (semantifold_arena != NULL) {
        SemantifoldAllocation *allocation = semantifold_arena;
        semantifold_arena = allocation->next;
        free(allocation);
    }
    semantifold_arena_bytes = 0;
}

_Noreturn static inline void semantifold_fatal(const char *message, size_t length) {
    semantifold_cleanup();
    (void)fwrite(message, 1, length, stderr);
    exit(70);
}

static inline int64_t semantifold_integer_add(int64_t left, int64_t right) {
    int64_t result;
    if (__builtin_add_overflow(left, right, &result)) {
        semantifold_fatal("semantifold: integer overflow\\n", sizeof("semantifold: integer overflow\\n") - 1);
    }
    return result;
}

static inline int64_t semantifold_integer_subtract(int64_t left, int64_t right) {
    int64_t result;
    if (__builtin_sub_overflow(left, right, &result)) {
        semantifold_fatal("semantifold: integer overflow\\n", sizeof("semantifold: integer overflow\\n") - 1);
    }
    return result;
}

static inline int64_t semantifold_integer_multiply(int64_t left, int64_t right) {
    int64_t result;
    if (__builtin_mul_overflow(left, right, &result)) {
        semantifold_fatal("semantifold: integer overflow\\n", sizeof("semantifold: integer overflow\\n") - 1);
    }
    return result;
}

static inline int64_t semantifold_integer_negate(int64_t value) {
    return semantifold_integer_subtract(INT64_C(0), value);
}

static inline size_t semantifold_allocation_size(size_t left, size_t right) {
    const size_t maximum = (size_t)PTRDIFF_MAX;
    if (left > maximum || right > maximum - left ||
        left + right > maximum - sizeof(SemantifoldAllocation)) {
        semantifold_fatal("semantifold: allocation size\\n", sizeof("semantifold: allocation size\\n") - 1);
    }
    const size_t size = sizeof(SemantifoldAllocation) + left + right;
    if (semantifold_arena_bytes > maximum - size) {
        semantifold_fatal("semantifold: allocation size\\n", sizeof("semantifold: allocation size\\n") - 1);
    }
    return size;
}

static inline SemantifoldString semantifold_string_concat(SemantifoldString left, SemantifoldString right) {
    const size_t size = semantifold_allocation_size(left.length, right.length);
    SemantifoldAllocation *allocation = malloc(size);
    if (allocation == NULL) {
        semantifold_fatal("semantifold: allocation failure\\n", sizeof("semantifold: allocation failure\\n") - 1);
    }
    allocation->next = semantifold_arena;
    semantifold_arena = allocation;
    semantifold_arena_bytes += size;
    if (left.length != 0) (void)memcpy(allocation->data, left.data, left.length);
    if (right.length != 0) (void)memcpy(allocation->data + left.length, right.data, right.length);
    return (SemantifoldString){allocation->data, left.length + right.length};
}

static inline bool semantifold_string_equal(SemantifoldString left, SemantifoldString right) {
    return left.length == right.length && (left.length == 0 || memcmp(left.data, right.data, left.length) == 0);
}

static inline bool semantifold_string_not_equal(SemantifoldString left, SemantifoldString right) {
    return !semantifold_string_equal(left, right);
}

static inline void semantifold_write(const unsigned char *data, size_t length) {
    if (length != 0 && fwrite(data, 1, length, stdout) != length) {
        semantifold_fatal("semantifold: output failure\\n", sizeof("semantifold: output failure\\n") - 1);
    }
}

static inline void semantifold_newline(void) {
    semantifold_write((const unsigned char *)"\\n", 1);
    if (fflush(stdout) != 0) semantifold_fatal("semantifold: output failure\\n", sizeof("semantifold: output failure\\n") - 1);
}

static inline void semantifold_print_string(SemantifoldString value) {
    semantifold_write(value.data, value.length);
    semantifold_newline();
}

static inline void semantifold_print_boolean(bool value) {
    if (value) semantifold_write((const unsigned char *)"true", 4);
    else semantifold_write((const unsigned char *)"false", 5);
    semantifold_newline();
}

static inline void semantifold_print_integer(int64_t value) {
    unsigned char digits[20];
    size_t position = sizeof(digits);
    uint64_t magnitude = (uint64_t)value;
    if (value < 0) magnitude = UINT64_C(0) - magnitude;
    do {
        digits[--position] = (unsigned char)(UINT64_C(48) + magnitude % UINT64_C(10));
        magnitude /= UINT64_C(10);
    } while (magnitude != 0);
    if (value < 0) digits[--position] = (unsigned char)45;
    semantifold_write(digits + position, sizeof(digits) - position);
    semantifold_newline();
}

#endif
`
