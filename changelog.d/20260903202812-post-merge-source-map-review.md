Fixed Source Map v3 composition with inner or outer `sourceRoot` values so resolved source names retain deterministic ordering without phantom raw-name entries or duplicated `sourcesContent`.

Rejected stale and out-of-bounds node-attached provenance when a malformed aggregate source registry leaves no exact source content capable of verifying those origins.
