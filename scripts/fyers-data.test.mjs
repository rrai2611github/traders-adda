import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  assertDataAvailable, currentUsage, dataBackoff, FYERS_DATA_MIN_GAP_MS, FYERS_DATA_PER_MINUTE, FYERS_LOCAL_DAILY_BUDGET, FyersDataPausedError, FyersReadCache,
} from "../src/lib/fyers/dataPolicy.ts";

const now = Date.parse("2026-11-02T05:00:00Z");

test("daily budget is exact, survives saved state, and resets at IST midnight", () => {
  const usage = {...currentUsage(null, now),requests:FYERS_LOCAL_DAILY_BUDGET-1};
  assert.doesNotThrow(()=>assertDataAvailable(usage,now));
  assert.throws(()=>assertDataAvailable({...usage,requests:FYERS_LOCAL_DAILY_BUDGET},now),FyersDataPausedError);
  const blocked = {...usage,...dataBackoff(now,400,"You've reached the Standard plan limit of 5,000 requests/day.")};
  assert.equal(blocked.blockedUntil,Date.parse("2026-11-02T18:30:00Z"));
  assert.throws(()=>assertDataAvailable(currentUsage(JSON.parse(JSON.stringify(blocked)),now+1000),now+1000),FyersDataPausedError);
  assert.equal(currentUsage(blocked,blocked.blockedUntil).requests,0);
  assert.equal(dataBackoff(now,429,"Too many requests").blockedUntil,now+60_000);
  assert.equal(dataBackoff(now,503,"Unavailable").blockedUntil,now+30_000);
  assert.equal(dataBackoff(now,400,"Invalid symbol"),null);
  assert.equal(dataBackoff(now,400,"You've reached the Standard plan limit of 5 requests/second.").blockedUntil,now+60_000);
  assert.equal(dataBackoff(now,400,"You've reached the Standard plan limit of 50 requests/minute.").blockedUntil,now+60_000);
  assert.ok(FYERS_DATA_MIN_GAP_MS >= 1500, "leave headroom below fifty requests/minute");
  assert.ok(FYERS_DATA_PER_MINUTE <= 40);
});

test("identical concurrent reads share one fetch, errors are retriable, and zero-TTL reads expire", async () => {
  const cache = new FyersReadCache();
  let calls=0;
  const load=async()=>{calls++;return {fetchedAt:123};};
  const first=cache.get("quotes",10_000,Date.now(),load);
  assert.equal(cache.get("quotes",10_000,Date.now(),load),first);
  assert.deepEqual(await first,{fetchedAt:123});
  assert.equal(calls,1);
  assert.equal((await cache.get("quotes",10_000,Date.now(),load)).fetchedAt,123);
  await assert.rejects(cache.get("error",1000,Date.now(),async()=>{throw new Error("failed");}),/failed/);
  assert.deepEqual(await cache.get("error",0,Date.now(),load),{fetchedAt:123});
  await cache.get("error",0,Date.now()+1,load);
  assert.equal(calls,3);
});

test("client counts actual mock fetches, persists daily backoff and never retries paused reads", async () => {
  const cwd=process.cwd();
  const dir=mkdtempSync(join(tmpdir(),"traders-fyers-data-test-"));
  const originalFetch=globalThis.fetch;
  const appId=process.env.FYERS_APP_ID, secret=process.env.FYERS_SECRET_ID;
  let calls=0;
  const sent=[];
  try {
    process.chdir(dir);
    mkdirSync(join(dir,".cache"));
    writeFileSync(join(dir,".cache","fyers-token.json"),JSON.stringify({accessToken:"test-only",issuedAt:Date.now()}));
    process.env.FYERS_APP_ID="test-only";process.env.FYERS_SECRET_ID="test-only";
    globalThis.fetch=async(url)=>{
      calls++;
      sent.push(Date.now());
      if (String(url).includes("/data/quotes")) return Response.json({s:"ok",d:[{n:"NSE:SBIN-EQ",s:"ok",v:{lp:100}}]});
      return Response.json({s:"error",message:"Standard plan limit of 5,000 requests/day."},{status:400});
    };
    const {fyersQuotes,fyersHistory,fyersDataUsage}=await import("../src/lib/fyers/fyersClient.ts");
    const [a,b]=await Promise.all([fyersQuotes(["NSE:SBIN-EQ"]),fyersQuotes(["NSE:SBIN-EQ"])]);
    assert.deepEqual(a,b);assert.equal(calls,1);
    assert.equal((await fyersQuotes(["NSE:SBIN-EQ"]))[0].fetchedAt,a[0].fetchedAt);
    await assert.rejects(fyersHistory("NSE:NIFTY50-INDEX","D",1,2),/requests\/day/);
    assert.equal(calls,2);
    assert.ok(sent[1]-sent[0]>=FYERS_DATA_MIN_GAP_MS-10,"data requests respect the Standard-plan pacer");
    await assert.rejects(fyersHistory("NSE:NIFTYBANK-INDEX","D",1,2),FyersDataPausedError);
    assert.equal(calls,2);
    assert.equal(fyersDataUsage().requests,2);
    const saved=JSON.parse(readFileSync(join(dir,".cache","fyers-data-usage.json"),"utf8"));
    assert.equal(saved.endpoints["/data/history"],1);
    assert.ok(saved.blockedUntil>Date.now());
    assert.ok(!JSON.stringify(saved).includes("test-only"));
    const clientUrl=new URL("../src/lib/fyers/fyersClient.ts",import.meta.url).href;
    const restarted=spawnSync(process.execPath,["--input-type=module","-e",`
      import assert from 'node:assert/strict';
      const client=await import(${JSON.stringify(clientUrl)});
      globalThis.fetch=()=>{throw new Error('Paused request reached transport');};
      assert.equal(client.fyersDataUsage().requests,2);
      await assert.rejects(client.fyersHistory('NSE:NIFTY50-INDEX','D',3,4),e=>e.name==='FyersDataPausedError');
    `],{cwd:dir,encoding:"utf8"});
    assert.equal(restarted.status,0,restarted.stderr);
  } finally {
    globalThis.fetch=originalFetch;
    if(appId===undefined)delete process.env.FYERS_APP_ID;else process.env.FYERS_APP_ID=appId;
    if(secret===undefined)delete process.env.FYERS_SECRET_ID;else process.env.FYERS_SECRET_ID=secret;
    process.chdir(cwd);rmSync(dir,{recursive:true,force:true});
  }
});
