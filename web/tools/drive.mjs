// Drive the CTR web build in headless Chrome over raw CDP (Node 24 global WebSocket).
// Dev tool, see web/tools/README.md.
// usage: node drive.mjs <url> <outDir> <steps.json> [--port=9334] [--keep] [--swiftshader] [--throttle=N]
//   Reuses a Chrome already listening on --port (opens a fresh tab, closes it after); otherwise launches one.
//   --keep leaves a launched Chrome running for the next run. Use different ports to run in parallel.
// steps: {"wait":ms} {"key":"c"|"Enter"|"F5"|...,"hold":ms} {"down":k} {"up":k} {"throttle":rate}
//        {"shot":"name"} {"profile":"start"} {"profile":"stop","name":"x"} {"eval":"js","name":"file"}
//        {"until":"js returning truthy","timeout":ms,"tap":key,"every":ms} {"saveState":"file"} (MEMFS quick state -> outDir)
//        {"throttle":"arg"} uses --throttle=N (default 1)
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const argv = process.argv.slice(2);
const [url, outDir, stepsFile] = argv.filter((a) => !a.startsWith("--"));
const opt = (name, def) => (argv.find((a) => a.startsWith(`--${name}=`)) || "").split("=")[1] || def;
const has = (name) => argv.includes(`--${name}`);
const port = Number(opt("port", "9334"));
const steps = JSON.parse(fs.readFileSync(stepsFile, "utf8"));
fs.mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
const stamp = () => ((Date.now() - t0) / 1000).toFixed(1).padStart(6) + "s";

const KEYS = {
	Enter: 13, Escape: 27, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40,
	F1: 112, F2: 113, F3: 114, F4: 115, F5: 116, F6: 117, F7: 118, F8: 119, F9: 120, F10: 121,
};

const devtools = `http://127.0.0.1:${port}`;
const alive = async () => { try { return (await fetch(`${devtools}/json/version`)).ok; } catch { return false; } };
let proc = null;
if (!(await alive())) {
	const gpuArgs = has("swiftshader")
		? ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"]
		: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"];
	proc = spawn("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", [
		"--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${path.join(os.tmpdir(), `ctr-chrome-${port}`)}`,
		"--no-first-run", "--no-default-browser-check", "--autoplay-policy=no-user-gesture-required",
		"--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--window-size=900,1000",
		...gpuArgs, "about:blank",
	], { stdio: "ignore", detached: has("keep") });
	if (has("keep")) proc.unref();
	for (let i = 0; i < 50 && !(await alive()); i++) await sleep(200);
	console.log(stamp(), "launched chrome on", port);
} else {
	console.log(stamp(), "reusing chrome on", port);
}

const target = await (await fetch(`${devtools}/json/new?about:blank`, { method: "PUT" })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let id = 0;
const pending = new Map();
const logs = [];
ws.addEventListener("message", (ev) => {
	const msg = JSON.parse(ev.data);
	if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
	if (msg.method === "Runtime.consoleAPICalled") logs.push(`[${msg.params.type}] ` + msg.params.args.map((a) => a.value ?? a.description ?? "").join(" "));
	if (msg.method === "Runtime.exceptionThrown") logs.push("[exception] " + (msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text));
});
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJs = async (expr) => (await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
const keyEvent = (type, k) => {
	const code = KEYS[k] ?? k.toUpperCase().charCodeAt(0);
	const name = KEYS[k] ? k : "Key" + k.toUpperCase();
	return send("Input.dispatchKeyEvent", { type, key: KEYS[k] ? k : k, code: name, windowsVirtualKeyCode: code });
};

try {
	await send("Runtime.enable");
	await send("Page.enable");
	await send("Profiler.enable");
	await send("Page.navigate", { url });
	for (let i = 0; i < 100 && !(await evalJs("document.readyState === 'complete' && typeof createCtrModule === 'function'")); i++) await sleep(100);
	await evalJs("document.getElementById('start').click()");
	console.log(stamp(), "started");

	for (const s of steps) {
		if (s.wait) await sleep(s.wait);
		if (s.until) {
			const deadline = Date.now() + (s.timeout || 30000);
			// optional "tap": press this key every "every" ms while waiting (e.g. skip intro screens)
			let nextTap = 0;
			while (!(await evalJs(s.until)) && Date.now() < deadline) {
				if (s.tap && Date.now() >= nextTap) { await keyEvent("keyDown", s.tap); await sleep(60); await keyEvent("keyUp", s.tap); nextTap = Date.now() + (s.every || 700); }
				await sleep(100);
			}
			console.log(stamp(), Date.now() < deadline ? "until ok" : "until TIMEOUT", s.until.slice(0, 60));
		}
		if (s.throttle) { const rate = s.throttle === "arg" ? Number(opt("throttle", "1")) : s.throttle; await send("Emulation.setCPUThrottlingRate", { rate }); console.log(stamp(), "cpu throttle", rate); }
		if (s.key) { await keyEvent("keyDown", s.key); await sleep(s.hold || 80); await keyEvent("keyUp", s.key); }
		if (s.down) await keyEvent("keyDown", s.down);
		if (s.up) await keyEvent("keyUp", s.up);
		if (s.shot) {
			const shot = await send("Page.captureScreenshot", { format: "jpeg", quality: 70, clip: { x: 16, y: 86, width: 800, height: 600, scale: 0.5 } });
			fs.writeFileSync(path.join(outDir, s.shot + ".jpg"), Buffer.from(shot.result.data, "base64"));
			console.log(stamp(), "shot", s.shot);
		}
		if (s.profile === "start") {
			await send("Profiler.setSamplingInterval", { interval: 200 });
			await send("Profiler.start");
			console.log(stamp(), "profile start");
		}
		if (s.profile === "stop") {
			const prof = (await send("Profiler.stop")).result.profile;
			fs.writeFileSync(path.join(outDir, s.name + ".cpuprofile"), JSON.stringify(prof));
			console.log(stamp(), "profile saved", s.name);
		}
		if (s.eval) {
			const v = await evalJs(s.eval);
			fs.writeFileSync(path.join(outDir, s.name), typeof v === "string" ? v : JSON.stringify(v));
			console.log(stamp(), "eval saved", s.name);
		}
		if (s.saveState) {
			const b64 = await evalJs(`(() => { const d = window.ctrModule.FS.readFile('/debug/states/quick.ctrstates'); let s = ''; for (let i = 0; i < d.length; i += 0x8000) s += String.fromCharCode.apply(null, d.subarray(i, i + 0x8000)); return btoa(s); })()`);
			if (b64) fs.writeFileSync(path.join(outDir, s.saveState), Buffer.from(b64, "base64"));
			console.log(stamp(), b64 ? `state saved ${s.saveState} (${Math.round(b64.length * 0.75)} bytes)` : "state NOT found");
		}
	}
	fs.writeFileSync(path.join(outDir, "pagelog.txt"), (await evalJs("document.getElementById('log').textContent")) || "");
	fs.writeFileSync(path.join(outDir, "console.txt"), logs.join("\n"));
} finally {
	try { await send("Emulation.setCPUThrottlingRate", { rate: 1 }); } catch {}
	try { ws.close(); } catch {}
	try { await fetch(`${devtools}/json/close/${target.id}`); } catch {}
	if (proc && !has("keep")) proc.kill();
	console.log(stamp(), "done");
	process.exit(0);
}
