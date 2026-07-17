#!/usr/bin/env python3
"""Build test/js-native-api addons without node-gyp, so the Node-API conformance suite can run.

Each binding.gyp holds MULTIPLE targets, each with its own sources and defines (6_object_wrap
alone builds three addons from overlapping files). Compiling a directory's files together
produces duplicate _Init/_napi_register_module_v1 symbols and fails to link — so parse the
gyp and honour it per target.

Two traps this encodes:
  * .c must be compiled as C. Forcing -x c++ makes legal C (`char* p = malloc(...)`) an error.
  * NAPI_EXPERIMENTAL is per-target, NOT global: it changes node_api_basic_finalize to take a
    const napi_env, so defining it everywhere breaks every test written against the stable
    signature.
"""
import json, re, subprocess, sys, os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SUITE = ROOT / "test" / "js-native-api"
INC = ["-I" + str(ROOT / "src"), "-I" + str(SUITE)]

def load_gyp(p: Path):
    t = p.read_text()
    t = re.sub(r"#.*", "", t)                 # gyp comments
    # gyp is python-dict-ish, not json: single quotes and trailing commas are both legal.
    t = t.replace("'", '"')
    t = re.sub(r",(\s*[}\]])", r"\1", t)      # trailing commas
    return json.loads(t)

def main():
    built = failed = 0
    fails = []
    for d in sorted(SUITE.iterdir()):
        gyp = d / "binding.gyp"
        if not gyp.is_file():
            continue
        try:
            spec = load_gyp(gyp)
        except Exception as e:
            fails.append(f"{d.name}(gyp:{e})"); failed += 1; continue
        outdir = d / "build" / "Release"
        outdir.mkdir(parents=True, exist_ok=True)
        for tgt in spec.get("targets", []):
            name = tgt["target_name"]
            defines = ["-D" + x for x in tgt.get("defines", [])]
            srcs = [d / s for s in tgt.get("sources", []) if s.endswith((".c", ".cc"))]
            if not srcs:
                continue
            objs = []
            ok = True
            for s in srcs:
                o = f"/tmp/napi_{d.name}_{name}_{s.stem}.o"
                cc = ["clang", "-std=c11"] if s.suffix == ".c" else ["clang++", "-std=c++17"]
                r = subprocess.run(cc + ["-c", "-fPIC", "-w"] + defines + INC + ["-o", o, str(s)],
                                   capture_output=True, text=True)
                if r.returncode != 0:
                    fails.append(f"{d.name}/{name}"); ok = False
                    if "-v" in sys.argv: print(r.stderr[:400])
                    break
                objs.append(o)
            if not ok:
                failed += 1; continue
            r = subprocess.run(["clang++", "-shared", "-undefined", "dynamic_lookup",
                                "-o", str(outdir / f"{name}.node")] + objs,
                               capture_output=True, text=True)
            if r.returncode != 0:
                fails.append(f"{d.name}/{name}(link)"); failed += 1
                if "-v" in sys.argv: print(r.stderr[:400])
            else:
                built += 1
    print(f"built {built} addons, {failed} failed")
    if fails: print("failed:", " ".join(fails))
    return 0

if __name__ == "__main__":
    sys.exit(main())
