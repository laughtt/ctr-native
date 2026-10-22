// Dev server: serves web/ and build-web/ on http://localhost:8090 with COOP/COEP headers.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const roots = [here, path.join(here, "..", "build-web")];
const port = Number(process.env.PORT) || 8090;
const mime = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".mjs": "text/javascript; charset=utf-8",
	".wasm": "application/wasm",
	".json": "application/json",
	".css": "text/css; charset=utf-8",
	".map": "application/json",
};

http.createServer((req, res) => {
	const urlPath = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
	let rel = path.normalize(urlPath === "/" ? "/index.html" : urlPath);
	while (rel[0] === "/" || rel[0] === String.fromCharCode(92)) rel = rel.slice(1);
	let found = null;
	for (const root of roots) {
		const full = path.join(root, rel);
		if (full.startsWith(root) && fs.existsSync(full) && fs.statSync(full).isFile()) {
			found = full;
			break;
		}
	}
	res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
	res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
	res.setHeader("Cache-Control", "no-store");
	// Dev only: CTR_DISC=<path to your own ctr-u.bin> serves it at /disc.bin (Range reads) for ?disc=/disc.bin
	if (urlPath === "/disc.bin" && process.env.CTR_DISC) {
		const size = fs.statSync(process.env.CTR_DISC).size;
		const m = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || "");
		res.setHeader("Accept-Ranges", "bytes");
		if (!m) {
			res.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Length": size });
			if (req.method === "HEAD") return res.end();
			return fs.createReadStream(process.env.CTR_DISC).pipe(res);
		}
		const start = Number(m[1]);
		const end = Math.min(m[2] ? Number(m[2]) : size - 1, size - 1);
		res.writeHead(206, { "Content-Type": "application/octet-stream", "Content-Length": end - start + 1, "Content-Range": `bytes ${start}-${end}/${size}` });
		return fs.createReadStream(process.env.CTR_DISC, { start, end }).pipe(res);
	}
	if (!found) {
		res.writeHead(404);
		res.end("not found");
		return;
	}
	res.writeHead(200, { "Content-Type": mime[path.extname(found).toLowerCase()] || "application/octet-stream" });
	fs.createReadStream(found).pipe(res);
}).listen(port, () => console.log(`serving web/ and build-web/ on http://localhost:${port}`));
