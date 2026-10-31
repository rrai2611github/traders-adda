import test from "node:test";
import assert from "node:assert/strict";
import { GLOSSARY } from "../src/lib/glossary.ts";

test("every glossary word has a name and a short plain explanation", () => {
  const entries = Object.entries(GLOSSARY);
  assert.ok(entries.length >= 15);
  const names = new Set();
  for (const [key, { name, text }] of entries) {
    assert.ok(name.length >= 1, key);
    assert.ok(text.length > 40 && text.length <= 300, `${key} is ${text.length} characters`);
    assert.ok(text.endsWith("."), `${key} should end with a full stop`);
    assert.ok(!names.has(name), `${name} is listed twice`);
    names.add(name);
  }
});

test("the numbers quoted in the glossary match the main plan", () => {
  assert.match(GLOSSARY.stop.text, /12%/);
  assert.match(GLOSSARY.marketCheck.text, /35%/);
  assert.match(GLOSSARY.positionSize.text, /2%/);
  assert.match(GLOSSARY.positionSize.text, /20%/);
  assert.match(GLOSSARY.winRate.text, /45%/);
  assert.match(GLOSSARY.exit50.text, /50 sessions/);
});
