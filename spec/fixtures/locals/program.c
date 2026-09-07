/* semantifold:program:c:v1 */
#include "semantifold_runtime.h"

static SemantifoldString select(bool flag, SemantifoldString fallback);

static SemantifoldString select(bool flag, SemantifoldString fallback) {
    (void)flag;
    (void)fallback;
    /* semantifold:ordered-expression:c:v1 begin 000001 275c54c4809d7893249a65005df5f94e6e4ac78b1a1ca79a183471f375367cef */
    const SemantifoldString preferred = SEMANTIFOLD_STRING("\171\145\163");
    (void)preferred;
    /* semantifold:ordered-expression:c:v1 end 000001 275c54c4809d7893249a65005df5f94e6e4ac78b1a1ca79a183471f375367cef */
    /* semantifold:ordered-expression:c:v1 begin 000002 ebb6c087ce97bcb9fe3a3c6c24f12b26144894a6c0bf71d49dc3f193c05cfbc3 */
    SemantifoldString result = fallback;
    (void)result;
    /* semantifold:ordered-expression:c:v1 end 000002 ebb6c087ce97bcb9fe3a3c6c24f12b26144894a6c0bf71d49dc3f193c05cfbc3 */
    /* semantifold:ordered-expression:c:v1 begin 000003 48ea2cc331dd63d0a145cd419ccbfd1d22b8b65b64e855e571c9746e4da540bd */
    if (flag) {
        /* semantifold:ordered-expression:c:v1 begin 000004 7cd38964857097497abb630bb6b482b070d99eae61fabba1ecc218b795f75ec3 */
        result = preferred;
        /* semantifold:ordered-expression:c:v1 end 000004 7cd38964857097497abb630bb6b482b070d99eae61fabba1ecc218b795f75ec3 */
        /* semantifold:ordered-expression:c:v1 begin 000005 0ba4a8242741fd1dda87e459e9c5f9d4e5245064282cb6f2bd104840f3656edd */
        return result;
        /* semantifold:ordered-expression:c:v1 end 000005 0ba4a8242741fd1dda87e459e9c5f9d4e5245064282cb6f2bd104840f3656edd */
    } else {
        /* semantifold:ordered-expression:c:v1 begin 000006 0ba4a8242741fd1dda87e459e9c5f9d4e5245064282cb6f2bd104840f3656edd */
        return result;
        /* semantifold:ordered-expression:c:v1 end 000006 0ba4a8242741fd1dda87e459e9c5f9d4e5245064282cb6f2bd104840f3656edd */
    }
    /* semantifold:ordered-expression:c:v1 end 000003 48ea2cc331dd63d0a145cd419ccbfd1d22b8b65b64e855e571c9746e4da540bd */
}

int main(void) {
    (void)select;
    /* semantifold:ordered-expression:c:v1 begin 000007 17ad2ea510554e918e35f60ec59f150b676cca3ef8810f496ba1206dce36e3a7 */
    SemantifoldString output = SEMANTIFOLD_STRING("\156\157");
    (void)output;
    /* semantifold:ordered-expression:c:v1 end 000007 17ad2ea510554e918e35f60ec59f150b676cca3ef8810f496ba1206dce36e3a7 */
    /* semantifold:ordered-expression:c:v1 begin 000008 37a5d4c0a9d2312202f1643fce83edd97a3a96c9a4eafb9bb4d5a3bbeb25de47 */
    SemantifoldString semantifold_ordered_000001 = select(true, output);
    output = semantifold_ordered_000001;
    /* semantifold:ordered-expression:c:v1 end 000008 37a5d4c0a9d2312202f1643fce83edd97a3a96c9a4eafb9bb4d5a3bbeb25de47 */
    /* semantifold:ordered-expression:c:v1 begin 000009 9d74f8e8969dd2098e40b1956796947ce0535af915dfe5000bd93b2024616dc4 */
    semantifold_print_string(output);
    /* semantifold:ordered-expression:c:v1 end 000009 9d74f8e8969dd2098e40b1956796947ce0535af915dfe5000bd93b2024616dc4 */
    semantifold_cleanup();
    return 0;
}
