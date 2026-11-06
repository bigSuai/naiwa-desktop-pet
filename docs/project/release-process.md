# Release Process

Use this flow when preparing a Naiwa app release. Tagged releases currently
publish Windows x64 / ARM64 NSIS installers and portable executables. macOS and
Linux remain available through the manual workflow's `platforms: all` option;
those artifacts are not automatically published as verified Naiwa binaries.

## Before Tagging

1. Update `package.json` to the release version.
2. Add `docs/releases/release-vX.Y.Z.md`.
3. Run the local tests that match the change scope. For full release prep, run:

```bash
npm test
node scripts/verify-sidecar-binaries.js prebuild:all
```

4. Run the `Build & Release` workflow manually on `main`.

Manual workflow dispatch defaults to Windows; `platforms: all` also builds the
original macOS and Linux artifacts. It fetches the
pinned `cc-connect-clawd` sidecar release, verifies source-pinned checksums, and
uploads build artifacts. It does not publish a GitHub Release.

## Draft Release

After the manual build artifacts look good, create and push the final version
tag:

```bash
git tag vX.Y.Z
git push origin vX.Y.Z
```

Pushing a `v*` tag builds Windows and creates a draft GitHub Release with the
installers, portable executables, blockmaps, `latest.yml`, SHA-256 checksums and
release notes. Draft releases are not
visible to normal users and are not consumed by the updater.

Download and smoke-test the draft release assets before publishing the draft.
If the draft is wrong, fix the issue before publishing; do not publish a known
bad draft release.

## Sidecar Dependency

Clawd release builds do not consume upstream `cc-connect` latest artifacts. They
download the fixed `cc-connect-clawd` fork release pinned by
`scripts/fetch-sidecar-binaries.js`, verify SHA256 values pinned in that script,
and package those binaries into app resources.

When the sidecar needs an upstream update, publish a new fixed sidecar release
from the fork first, then update the Clawd pin and rerun the fetch/verify tests.
