import { execFile } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);

const root = dirname(fileURLToPath(import.meta.url));
const artifacts = join(root, "artifacts");

const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as { name: string };
const output = join(artifacts, `${pkg.name}-source.zip`);

await mkdir(artifacts, { recursive: true });
await run("git", ["archive", "--format=zip", "--output", output, "HEAD"], { cwd: root });

process.stdout.write(`wrote ${output}\n`);
