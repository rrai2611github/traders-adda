import test from "node:test";
import assert from "node:assert/strict";
import { emailConfig } from "../src/lib/alerts/smtp.ts";
import { emailProviderConfig } from "../src/lib/emailProvider.ts";

const BASE = {
  RESEND_API_KEY: "re_test_key",
  EMAIL_FROM: "no-reply@example.com",
  EMAIL_REPLY_TO: "tradersaddaofficial@gmail.com",
  EMAIL_TO: "reader@example.com",
  EMAIL_FROM_NAME: "",
};

/** Runs `fn` with exactly the given email environment, then restores it. */
function withEnv(overrides, fn) {
  const keys = [...Object.keys(BASE), "EMAIL_FROM", "EMAIL_FROM_NAME"];
  const prior = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  try {
    for (const [key, value] of Object.entries({ ...BASE, ...overrides })) {
      if (value === undefined || value === "") delete process.env[key];
      else process.env[key] = value;
    }
    return fn();
  } finally {
    for (const key of keys) {
      if (prior[key] === undefined) delete process.env[key];
      else process.env[key] = prior[key];
    }
  }
}

test("the sender name defaults to the brand", () => {
  const config = withEnv({}, emailConfig);
  assert.equal(config.fromName, "Traders Adda");
});

test("the sender name is configurable", () => {
  const config = withEnv({ EMAIL_FROM_NAME: "Traders Adda Research" }, emailConfig);
  assert.equal(config.fromName, "Traders Adda Research");
});

test("quotes and newlines cannot break out of the From header", () => {
  const config = withEnv({ EMAIL_FROM_NAME: 'Evil" <attacker@example.com>\r\nBcc: victim@example.com' }, emailConfig);
  assert.doesNotMatch(config.fromName, /["\r\n]/);
});

test("the configured From and reply-to addresses are used", () => {
  assert.equal(withEnv({}, emailConfig).from, "no-reply@example.com");
  assert.equal(withEnv({}, emailProviderConfig).replyTo, "tradersaddaofficial@gmail.com");
});

test("repeated recipients are sent to once, ignoring case and spacing", () => {
  const config = withEnv({ EMAIL_TO: "a@example.com, b@example.com,A@Example.com , ,b@example.com" }, emailConfig);
  assert.equal(config.to, "a@example.com,b@example.com");
});

test("missing required settings mean not configured", () => {
  assert.equal(withEnv({ RESEND_API_KEY: "" }, emailConfig), null);
  assert.equal(withEnv({ EMAIL_FROM: "" }, emailConfig), null);
  assert.equal(withEnv({ EMAIL_TO: "" }, emailConfig), null);
});
