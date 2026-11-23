import test from "node:test";
import assert from "node:assert/strict";
import { MEMBER_BACKTEST_PRESETS, getMemberBacktestPreset, getMemberBacktestPresetFromBody } from "../src/lib/backtest/memberPresets.ts";

test("member presets are limited to fixed screen strategies and the tested risk rules", () => {
  assert.equal(MEMBER_BACKTEST_PRESETS.length, 3);
  for (const preset of MEMBER_BACKTEST_PRESETS) {
    assert.equal(preset.settings.entry, "next-open");
    assert.deepEqual(preset.settings.stop, { kind: "percent", percent: 12 });
    assert.deepEqual(preset.settings.exit, { kind: "ma", type: "sma", period: 50, when: "close" });
    assert.equal(preset.settings.sizing.kind, "risk");
    assert.equal(preset.settings.sizing.riskPercent, 2);
    assert.equal(preset.settings.positionCapPercent, 20);
    assert.equal(preset.settings.maxPositions, 10);
    assert.equal(preset.settings.maxNewPerDay, 3);
    assert.equal(preset.settings.costPercent, 0.25);
    assert.equal(preset.settings.breadthMin, 35);
    assert.equal(preset.settings.strategy.kind, "screen");
    assert.equal("symbol" in preset.settings, false);
  }
  assert.deepEqual(MEMBER_BACKTEST_PRESETS[0].settings.alsoScreens, ["Multi-year breakouts"]);
});

test("member preset lookup rejects arbitrary settings and unknown identifiers", () => {
  assert.equal(getMemberBacktestPreset("tested-combination")?.id, "tested-combination");
  assert.equal(getMemberBacktestPreset("custom"), null);
  assert.equal(getMemberBacktestPreset({ strategy: "leaders" }), null);
});

test("member backtest requests accept only one whitelisted preset identifier", () => {
  assert.equal(getMemberBacktestPresetFromBody({ presetId: "blue-sky" })?.id, "blue-sky");
  assert.equal(getMemberBacktestPresetFromBody({ presetId: "custom" }), null);
  assert.equal(getMemberBacktestPresetFromBody({ presetId: "blue-sky", capital: 1 }), null);
  assert.equal(getMemberBacktestPresetFromBody({ settings: { symbol: "TCS" } }), null);
  assert.equal(getMemberBacktestPresetFromBody([]), null);
});
