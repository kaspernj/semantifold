# Correct reviewed source provenance edge cases

- Require exact source content when importing mapped Source Map v3 positions so original offsets and reverse lookup remain correct.
- Report Java artifact basenames other than `Main.java` as located `UNSUPPORTED_CAPABILITY` diagnostics.
- Map reused semantic expression objects by their exact occurrence paths in every backend.
