Added the first concrete standard-library portability slice: parser-proved Ruby `TCPSocket` and bounded one-string `puts` facades now compile through canonical SocketClient, TextStream, Output, and Resource v1 contracts to protected PHP 8.2 core-stream providers, with typed failures, explicit resource lifetime, deterministic artifacts, and real loopback runtime coverage.

This remains a narrow Ruby-source-to-PHP-target profile. It does not add TCP servers, TLS, UDP, async I/O, configurable timeouts, arbitrary Ruby socket/output APIs, other source facades, or other target providers.
