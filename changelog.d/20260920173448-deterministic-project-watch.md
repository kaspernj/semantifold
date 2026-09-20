# Added

- Add `semantifold watch` and public deterministic watch coordination/reporting APIs with complete-graph hash reconciliation, serialized build/check cycles, native file-plus-parent subscriptions, bounded polling fallback, stale-candidate refusal, last-good recovery, and owned signal shutdown.

# Fixed

- Preserve pre-cycle polling state across post-publication edits, await startup shutdown, keep invalid-graph recovery timers bounded, and report topology resubscription fallback truthfully.
