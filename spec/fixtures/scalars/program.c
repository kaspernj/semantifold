/* semantifold:program:c:v1 */
#include "semantifold_runtime.h"

static SemantifoldString label(bool flag, SemantifoldString fallback);

static SemantifoldString label(bool flag, SemantifoldString fallback) {
    (void)flag;
    (void)fallback;
    /* semantifold:ordered-expression:c:v1 begin 000001 48ea2cc331dd63d0a145cd419ccbfd1d22b8b65b64e855e571c9746e4da540bd */
    if (flag) {
        /* semantifold:ordered-expression:c:v1 begin 000002 7869fb14271d99047eff3652e9d57a257dee79dfd606d369d53c4f8f32048402 */
        return SEMANTIFOLD_STRING("\171\145\163");
        /* semantifold:ordered-expression:c:v1 end 000002 7869fb14271d99047eff3652e9d57a257dee79dfd606d369d53c4f8f32048402 */
    } else {
        /* semantifold:ordered-expression:c:v1 begin 000003 2835df535bdc8c38528f6a7d3d9be1fbdf645a0fe6c57fb3b91e63905c668a21 */
        return fallback;
        /* semantifold:ordered-expression:c:v1 end 000003 2835df535bdc8c38528f6a7d3d9be1fbdf645a0fe6c57fb3b91e63905c668a21 */
    }
    /* semantifold:ordered-expression:c:v1 end 000001 48ea2cc331dd63d0a145cd419ccbfd1d22b8b65b64e855e571c9746e4da540bd */
}

int main(void) {
    (void)label;
    /* semantifold:ordered-expression:c:v1 begin 000004 5379e64d1ace16e712245f7c536f733cacba16e0a936006effbfa348ed1b7afc */
    SemantifoldString semantifold_ordered_000001 = label(true, SEMANTIFOLD_STRING("\156\157"));
    semantifold_print_string(semantifold_ordered_000001);
    /* semantifold:ordered-expression:c:v1 end 000004 5379e64d1ace16e712245f7c536f733cacba16e0a936006effbfa348ed1b7afc */
    semantifold_cleanup();
    return 0;
}
