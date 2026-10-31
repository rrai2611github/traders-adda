import test from "node:test";
import assert from "node:assert/strict";
import { sectorCues } from "../src/lib/screen/sectorCues.ts";

test("only clear overseas moves produce a sector note", () => {
  assert.deepEqual(sectorCues([{ label: "Brent crude", changePercent: 1.4 }, { label: "Nasdaq", changePercent: 0.9 }, { label: "Gold", changePercent: -1.4 }]), []);
  assert.deepEqual(sectorCues([]), []);
});

test("crude up helps ONGC and Oil India and pressures oil marketing companies; crude down does the opposite", () => {
  const up = sectorCues([{ label: "Brent crude", changePercent: 3.2 }]);
  assert.equal(up.length, 1);
  assert.match(up[0], /^Crude \+3\.2%: ONGC and Oil India usually rise; oil marketing companies .* mild pressure/);
  const down = sectorCues([{ label: "Brent crude", changePercent: -2 }]);
  assert.match(down[0], /^Crude −2\.0%: ONGC and Oil India usually fall; .* mild relief/);
});

test("Nasdaq and gold notes name the sectors that follow", () => {
  const out = sectorCues([{ label: "Nasdaq", changePercent: -2.86 }, { label: "Gold", changePercent: -3.29 }]);
  assert.match(out[0], /^Nasdaq −2\.9%: IT stocks/);
  assert.match(out[1], /^Gold −3\.3%: gold-loan lender Muthoot Finance/);
});

test("a cue that failed to load (not a number) is ignored", () => {
  assert.deepEqual(sectorCues([{ label: "Brent crude", changePercent: NaN }]), []);
});
