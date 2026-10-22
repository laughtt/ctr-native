"""Dev tool (web/tools/README.md). usage: python compare.py <runDir>...
Compare sweep runs: frame pacing/work from frame_times.csv (last 15 s of race) + top wasm self time."""
import csv, io, json, sys, statistics
from collections import defaultdict
for d in sys.argv[1:]:
    perf = json.load(open(f"{d}/perf.json", encoding="utf8"))
    rows = [r for r in csv.DictReader(io.StringIO(perf["frame_times.csv"])) if None not in r.values()]
    race = [r for r in rows if r["loading_stage"] == "-1"][-420:]
    tot = sorted(float(r["total_ms"]) for r in race); work = sorted(float(r["work_ms"]) for r in race)
    over = sum(t > 34 for t in tot)
    fps = 1000 * len(tot) / sum(tot)
    b = lambda k: statistics.mean(float(r[k]) for r in race)
    prof = json.load(open(f"{d}/race.cpuprofile", encoding="utf8"))
    nodes = {n["id"]: n["callFrame"]["functionName"] or "(" + n["callFrame"]["url"].split("/")[-1] + ")" for n in prof["nodes"]}
    self_ms = defaultdict(float)
    for sid, dt in zip(prof["samples"], prof["timeDeltas"]):
        self_ms[nodes[sid]] += dt / 1000
    busy = sum(v for k, v in self_ms.items() if k != "(idle)"); total = sum(self_ms.values())
    print(f"== {d.split('/')[-1]}: fps={fps:5.1f}  frame p50/p95/max={tot[len(tot)//2]:.0f}/{tot[int(len(tot)*.95)]:.0f}/{tot[-1]:.0f} ms  "
          f">34ms frames={over}/{len(tot)}  work mean/p95={statistics.mean(work):.1f}/{work[int(len(work)*.95)]:.0f} ms  "
          f"main thread busy={100*busy/total:.0f}%")
    print(f"   buckets mean ms: swap={b('swap_window_ms'):.1f} otag={b('draw_otag_ms'):.2f} game_logic={b('game_logic_ms'):.2f} "
          f"level_geom={b('mainframe_level_geometry_ms'):.2f} vertex_upload={b('renderer_vertex_upload_ms'):.2f} audio_vblank={b('audio_vblank_ms'):.2f} "
          f"underruns={sum(int(r['audio_underrun_delta']) for r in race)}")
    top = sorted(((v, k) for k, v in self_ms.items() if k != "(idle)"), reverse=True)[:9]
    print("   top:", "  ".join(f"{k}={100*v/total:.1f}%" for v, k in top))
