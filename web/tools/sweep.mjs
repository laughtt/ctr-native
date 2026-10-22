// Dev tool, see web/tools/README.md. Profile the race state at several CPU throttles in parallel, then compare.
// usage: node sweep.mjs <outDir> [--throttles=1,4,6] [--state=crashcove-race.ctrstates] [--base=http://127.0.0.1:8091]
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const outDir = argv.find((a) => !a.startsWith("--")) || "perf-out";
const opt = (name, def) => (argv.find((a) => a.startsWith(`--${name}=`)) || "").split("=").slice(1).join("=") || def;
const throttles = opt("throttles", "1,4,6").split(",").map(Number);
const url = `${opt("base", "http://127.0.0.1:8091")}/?disc=/disc.bin&state=/state/${opt("state", "crashcove-race.ctrstates")}&args=--perf-dir,/perf`;
const run = (cmd, args, tag) => new Promise((resolve) => {
	const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "inherit"] });
	let rest = "";
	p.stdout.on("data", (d) => {
		const lines = (rest + d).split("\n");
		rest = lines.pop();
		for (const line of lines) console.log(tag + line);
	});
	p.on("close", () => { if (rest) console.log(tag + rest); resolve(); });
});
const t0 = Date.now();
await Promise.all(throttles.map((t) => run("node", [path.join(here, "drive.mjs"), url, path.join(outDir, `x${t}`),
	path.join(here, "steps", "profile-race.json"), `--port=${9340 + t}`, "--keep", `--throttle=${t}`], `[x${t}] `)));
console.log(`sweep took ${((Date.now() - t0) / 1000).toFixed(0)} s`);
await run("python", ["-I", path.join(here, "compare.py"), ...throttles.map((t) => path.join(outDir, `x${t}`))], "");
