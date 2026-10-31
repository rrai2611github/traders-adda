"""Independently re-checks that every live screen member satisfies its bands.

The dials and presets are transcribed straight from the source bundle, so this
is a second opinion on `matchesScreen` rather than a call into it.
"""
import json
import urllib.request

DIALS = {
    "rs": (1, 99), "ext": (-30, 60), "vs50": (-60, 200), "vs200": (-80, 400),
    "nearHigh": (0, 100), "aboveLow": (1, 700), "coil": (0.3, 3), "dry": (0.05, 3),
    "baseWk": (2, 300), "baseDepth": (2, 90), "listedWk": (1, 600),
    "lvl": (1, 4), "turn": (0.1, 1300), "mcap": (1, 600000),
}
PRESETS = {
    "VCP": {"coil": (0.3, 0.9), "dry": (0.05, 0.9), "baseWk": (3, 300), "baseDepth": (2, 35),
            "vs50": (0, 200), "vs200": (0, 400), "nearHigh": (0, 30), "aboveLow": (15, 700), "rs": (70, 99)},
    "Blue sky": {"lvl": (1, 1), "rs": (70, 99), "ext": (-20, 0)},
    "Multi-year breakouts": {"baseWk": (52, 300), "ext": (-20, 0), "vs200": (0, 400), "rs": (60, 99)},
    "IPO base": {"listedWk": (2, 50), "baseWk": (3, 300), "baseDepth": (2, 35), "vs50": (0, 200), "ext": (-20, 0)},
}


def factor(row, key):
    if key == "nearHigh":
        return None if row["fromHigh"] is None else abs(row["fromHigh"])
    if key == "lvl":
        return row["level"]
    if key == "turn":
        return row["turnoverCr"]
    return row.get(key)


payload = json.load(urllib.request.urlopen("http://localhost:3000/api/market/screen", timeout=300))
rows = payload["rows"]
problems = []

for name, spec in PRESETS.items():
    members = {r["symbol"] for r in rows if name in r["screens"]}
    expected = set()
    for r in rows:
        ok = True
        for key, (lo, hi) in spec.items():
            dlo, dhi = DIALS[key]
            if lo <= dlo and hi >= dhi:
                continue  # band does not narrow the dial, so it filters nothing
            v = factor(r, key)
            if v is None or v < lo or v > hi:
                ok = False
                break
        if ok:
            expected.add(r["symbol"])
    if members != expected:
        problems.append(f"{name}: engine={sorted(members)} recheck={sorted(expected)}")
    print(f"{name:24} {len(members):3}  {sorted(members)}")

print()
print("MISMATCHES:", problems if problems else "none")

# A null market cap means "unknown", which the floor tolerates; turnover must be real.
floor_fails = [r["symbol"] for r in rows
               if (r["mcap"] is not None and r["mcap"] < 500)
               or r["turnoverCr"] is None or r["turnoverCr"] < 5]
print("rows below the liquidity floor:", floor_fails or "none")
unranked = [r["symbol"] for r in rows if r["rs"] is None]
print("unranked rows:", unranked or "none")
stages = {}
for r in rows:
    stages[r["stage"]] = stages.get(r["stage"], 0) + 1
print("stages:", stages)
