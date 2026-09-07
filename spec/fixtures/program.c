/* semantifold:program:c:v1 */
#include "semantifold_runtime.h"

static int64_t difference(int64_t left, int64_t right);

static int64_t difference(int64_t left, int64_t right) {
    (void)left;
    (void)right;
    /* semantifold:ordered-expression:c:v1 begin 000001 653448ec8c270400be3226a181c27e62c8105425eb2d94373ed39d5c8b96c468 */
    bool semantifold_ordered_000001 = (left > right);
    if (semantifold_ordered_000001) {
        /* semantifold:ordered-expression:c:v1 begin 000002 18cee81695dfee124b895b5d71b02cef500136671aa8a806aefc68004fbc3176 */
        int64_t semantifold_ordered_000002 = semantifold_integer_subtract(left, right);
        return semantifold_ordered_000002;
        /* semantifold:ordered-expression:c:v1 end 000002 18cee81695dfee124b895b5d71b02cef500136671aa8a806aefc68004fbc3176 */
    } else {
        /* semantifold:ordered-expression:c:v1 begin 000003 3bcc5a928e1b39d0e2f8718421557178c9ae4f45f545c76bd373da690c691d14 */
        int64_t semantifold_ordered_000003 = semantifold_integer_subtract(right, left);
        return semantifold_ordered_000003;
        /* semantifold:ordered-expression:c:v1 end 000003 3bcc5a928e1b39d0e2f8718421557178c9ae4f45f545c76bd373da690c691d14 */
    }
    /* semantifold:ordered-expression:c:v1 end 000001 653448ec8c270400be3226a181c27e62c8105425eb2d94373ed39d5c8b96c468 */
}

int main(void) {
    (void)difference;
    /* semantifold:ordered-expression:c:v1 begin 000004 c657787bb3e2d7c87de2eb1a2beece581c12ea828e616fddeb5cc7795393ab05 */
    int64_t semantifold_ordered_000004 = difference(INT64_C(4), INT64_C(9));
    semantifold_print_integer(semantifold_ordered_000004);
    /* semantifold:ordered-expression:c:v1 end 000004 c657787bb3e2d7c87de2eb1a2beece581c12ea828e616fddeb5cc7795393ab05 */
    semantifold_cleanup();
    return 0;
}
