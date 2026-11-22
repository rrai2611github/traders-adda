import test from "node:test";
import assert from "node:assert/strict";
import { sendEmailViaProvider, verifyEmailProvider } from "../src/lib/emailProvider.ts";

function withEmailEnv(run) {
  const keys = ["RESEND_API_KEY", "EMAIL_FROM", "EMAIL_FROM_NAME", "EMAIL_REPLY_TO"];
  const prior = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  Object.assign(process.env, {
    RESEND_API_KEY: "re_test_key",
    EMAIL_FROM: "no-reply@example.com",
    EMAIL_FROM_NAME: "Traders Adda",
    EMAIL_REPLY_TO: "tradersaddaofficial@gmail.com",
  });
  return Promise.resolve()
    .then(run)
    .finally(() => {
      for (const key of keys) {
        if (prior[key] === undefined) delete process.env[key];
        else process.env[key] = prior[key];
      }
      globalThis.fetch = originalFetch;
    });
}

test("sends through the HTTPS API with reply-to and inline attachments", () => withEmailEnv(async () => {
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify({ id: "email-id" }), { status: 200 });
  };

  const id = await sendEmailViaProvider({
    to: ["reader@example.com"],
    subject: "Test",
    html: '<img src="cid:logo">',
    text: "Test message",
    attachments: [{
      filename: "logo.jpg",
      content: Buffer.from("logo"),
      contentType: "image/jpeg",
      cid: "logo",
      contentDisposition: "inline",
    }],
  });

  assert.equal(id, "email-id");
  assert.equal(request.url, "https://api.resend.com/emails");
  assert.equal(request.options.method, "POST");
  assert.equal(request.options.headers.Authorization, "Bearer re_test_key");
  assert.deepEqual(JSON.parse(request.options.body), {
    from: "Traders Adda <no-reply@example.com>",
    to: ["reader@example.com"],
    subject: "Test",
    html: '<img src="cid:logo">',
    text: "Test message",
    reply_to: "tradersaddaofficial@gmail.com",
    attachments: [{
      filename: "logo.jpg",
      content: Buffer.from("logo").toString("base64"),
      content_type: "image/jpeg",
      content_id: "logo",
      content_disposition: "inline",
    }],
  });
}));

test("reports provider HTTP errors without exposing response bodies", () => withEmailEnv(async () => {
  globalThis.fetch = async () => new Response("private provider details", { status: 401 });
  await assert.rejects(
    sendEmailViaProvider({ to: "reader@example.com", subject: "Test", html: "", text: "" }),
    (error) => error.code === "RESEND_HTTP_401" && !error.message.includes("private"),
  );
}));

test("verifies the API key with the provider over HTTPS", () => withEmailEnv(async () => {
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify({ data: [] }), { status: 200 });
  };
  await verifyEmailProvider();
  assert.equal(request.url, "https://api.resend.com/domains");
  assert.equal(request.options.headers.Authorization, "Bearer re_test_key");
}));
