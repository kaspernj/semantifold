# Release-version package verification

- Keep package delivery checks independent of the initial public version: require a stable SemVer root version synchronized with both lockfile entries, and compare packed/installed versions with the source manifest.
- Preserve the existing strict single-package, private-runtime, clean-install, and TypeScript consumer checks across releases.
