## Requirements

- Node.js 26 or newer
- pnpm 11.17.0 (`npm install -g pnpm@11.17.0`)

Operating system: Linux

## Build

```sh
pnpm install --frozen-lockfile
pnpm build
```

Output is written to `dist/`, which matches the contents of the submitted add-on package exactly.

To produce the identical zip:

```sh
pnpm exec web-ext build --source-dir dist --artifacts-dir artifacts --overwrite-dest
```

## What the build does

`build.ts` performs three steps:

1. Copies `public/` (`manifest.json`, `popup.html`, `popup.css`, `icon.svg`) into `dist/`.
2. Sets the manifest `version` field from the git tag, taken from `RELEASE_TAG` when the release workflow sets it and otherwise from `git describe` against the most recent `v*.*.*` tag, falling back to `0.0.0` on an untagged checkout.
3. Runs esbuild on `src/content.ts` and `src/popup.ts`, inlining the shared module `src/shared.ts` into each, emitting `dist/content.js` and `dist/popup.js` as unminified IIFE bundles with no source maps (`minify: false`).

esbuild is the only build dependency. The extension has no runtime dependencies. Everything shipped comes from `src/` and `public/`.

## Notes

`pnpm package` is not usable outside the git repository, because it also builds a source archive with `git archive`. Use `web-ext build` as shown above.
