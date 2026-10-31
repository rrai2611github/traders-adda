import test from "node:test";
import assert from "node:assert/strict";
import { emailConfig } from "../src/lib/alerts/smtp.ts";

const BASE = {
  SMTP_HOST: "smtp.gmail.com",
  SMTP_PORT: "587",
  SMTP_SECURE: "0",
  SMTP_USER: "sender@gmail.com",
  SMTP_APP_PASSWORD: "abcd efgh ijkl mnop",
  EMAIL_TO: "reader@example.com",
  EMAIL_FROM: "",
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

test("the From address falls back to the authenticated user", () => {
  assert.equal(withEnv({}, emailConfig).from, "sender@gmail.com");
  assert.equal(withEnv({ EMAIL_FROM: "alias@gmail.com" }, emailConfig).from, "alias@gmail.com");
});

test("app password whitespace is stripped", () => {
  assert.equal(withEnv({}, emailConfig).password, "abcdefghijklmnop");
});

test("repeated recipients are sent to once, ignoring case and spacing", () => {
  const config = withEnv({ EMAIL_TO: "a@example.com, b@example.com,A@Example.com , ,b@example.com" }, emailConfig);
  assert.equal(config.to, "a@example.com,b@example.com");
});

test("missing required settings mean not configured", () => {
  assert.equal(withEnv({ SMTP_HOST: "" }, emailConfig), null);
  assert.equal(withEnv({ EMAIL_TO: "" }, emailConfig), null);
  assert.equal(withEnv({ SMTP_APP_PASSWORD: "" }, emailConfig), null);
  assert.equal(withEnv({ SMTP_PORT: "not-a-port" }, emailConfig), null);
});
