import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = dirname(fileURLToPath(import.meta.url));
const outdir = join(root, "dist");

const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as { version: string };

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });
await cp(join(root, "public"), outdir, { recursive: true });

const manifestPath = join(outdir, "manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
manifest.version = pkg.version;
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

await build({
  entryPoints: [join(root, "src/content.ts"), join(root, "src/popup.ts")],
  outdir,
  bundle: true,
  format: "iife",
  target: "firefox115",
  platform: "browser",
  minify: false,
  legalComments: "none",
});

process.stdout.write(`built ${manifest.version as string} into dist/\n`);
