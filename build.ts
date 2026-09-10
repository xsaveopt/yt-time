import { execFile } from "node:child_process";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { build } from "esbuild";

const run = promisify(execFile);

const root = dirname(fileURLToPath(import.meta.url));
const outdir = join(root, "dist");

const describe = async (): Promise<string | null> => {
  try {
    const { stdout } = await run("git", ["describe", "--tags", "--abbrev=0", "--match", "v*.*.*"], {
      cwd: root,
    });
    return stdout.trim();
  } catch {
    return null;
  }
};

const resolveVersion = async (): Promise<string> => {
  const tag = process.env.RELEASE_TAG ?? (await describe()) ?? "";
  const version = tag.replace(/^v/, "");
  return /^\d+\.\d+\.\d+$/.test(version) ? version : "0.0.0";
};

const version = await resolveVersion();

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });
await cp(join(root, "public"), outdir, { recursive: true });

const manifestPath = join(outdir, "manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
manifest.version = version;
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

await build({
  entryPoints: [
    join(root, "src/background.ts"),
    join(root, "src/content.ts"),
    join(root, "src/popup.ts"),
  ],
  outdir,
  bundle: true,
  format: "iife",
  target: "firefox115",
  platform: "browser",
  minify: false,
  legalComments: "none",
});

process.stdout.write(`built ${version} into dist/\n`);
