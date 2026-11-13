import test from "node:test";
import assert from "node:assert/strict";
import { APPLICATION_INTENTS, mentionedStocks, resolveResearchIntent } from "../src/lib/assistant/research.ts";
import { applicationAnswer, radarAnswer, radarCandidates } from "../src/lib/assistant/application.ts";

test("application questions need no symbol and radar paraphrases map correctly", () => {
  for (const question of ["Which are the best stock i can keep in my radar?", "Which stocks should I monitor?", "Show my watchlist candidates", "Which is the best stock to track?", "Show Top Picks"]) {
    assert.equal(resolveResearchIntent(question), "radar");
  }
  for (const [question, intent] of [["How is the market?","market"],["Which strategy does the app use?","strategy"],["How are the paper results?","performance"],["Is the application working?","operations"],["Why did the morning email fail?","operations"],["What scanners does the application have?","features"],["Why has paper trading not started?","operations"]]) {
    assert.equal(resolveResearchIntent(question),intent);
    assert.ok(APPLICATION_INTENTS.includes(intent));
  }
});

test("followups inherit only explicit app topics; unsupported actions are not hidden", () => {
  assert.equal(resolveResearchIntent("Why these stocks?","radar"),"radar");
  assert.equal(resolveResearchIntent("Show risks","radar"),"radar");
  assert.equal(resolveResearchIntent("Tell me more","strategy"),"strategy");
  assert.equal(resolveResearchIntent("Predict SBIN tomorrow","radar"),null);
  assert.equal(resolveResearchIntent("Place an order","radar"),null);
  assert.equal(resolveResearchIntent("What about news?","radar"),null);
  assert.equal(resolveResearchIntent("Hello","radar"),null);
});

test("stock mentions resolve canonical symbols or full names without ordinary-word symbols", () => {
  const instruments=[{symbol:"SBIN",name:"State Bank of India"},{symbol:"BANKINDIA",name:"Bank of India"},{symbol:"ICICIBANK",name:"ICICI Bank"},{symbol:"INFY",name:"Infosys"},{symbol:"IT",name:"Imaginary Textiles"}];
  assert.deepEqual(mentionedStocks("Analyse State Bank of India",instruments),["SBIN"]);
  assert.deepEqual(mentionedStocks("Compare SBIN and ICICIBANK",instruments),["SBIN","ICICIBANK"]);
  assert.deepEqual(mentionedStocks("Compare ICICIBANK and SBIN.",instruments),["ICICIBANK","SBIN"]);
  assert.deepEqual(mentionedStocks("Analyse Infosys",instruments),["INFY"]);
  assert.deepEqual(mentionedStocks("Analyse ICICI Banking",instruments),[]);
  assert.deepEqual(mentionedStocks("Compare State Bank of India and Bank of India",instruments),["SBIN","BANKINDIA"]);
  assert.deepEqual(mentionedStocks("Analyse STATE   BANK OF INDIA.",instruments),["SBIN"]);
  assert.deepEqual(mentionedStocks("Is it working?",instruments),[]);
  assert.deepEqual(mentionedStocks("Is Infosys bullish?",[{symbol:"INFY",name:"Infosys Limited"}]),["INFY"]);
});

test("radar preserves app ordering, omits extended names and caps six; empty is honest", () => {
  const picks=[{symbol:"A",tag:"broke"},{symbol:"B",tag:"ready"},{symbol:"C",tag:"extended"},{symbol:"D",tag:"watch"}];
  assert.deepEqual(radarCandidates(picks).map(p=>p.symbol),["A","B","D"]);
  assert.equal(radarCandidates(Array.from({length:10},(_,i)=>({symbol:String(i),tag:"ready"}))).length,6);
  assert.match(radarAnswer([],20,1,1,[]).summary,/No non-extended/);
  assert.ok(radarAnswer([],20,1,1,[]).sections.some(s=>s.lines.some(l=>l.includes("monitor only"))));
  assert.ok(radarAnswer([],34.9,1,1,[]).sections.some(s=>s.lines.some(l=>l.includes("monitor only"))));
  assert.ok(radarAnswer([],35,1,1,[]).sections.some(s=>s.lines.some(l=>l.includes("fresh execution data"))));
  assert.match(radarAnswer([],40,1,1,["Refresh failed"]).summary,/Data is limited/);
});

test("operational results keep unavailable values and failures, exclude manual positions", () => {
  const report={market:"Closed",checks:[{title:"Fyers",state:"error",detail:"Quota reached",lastAt:null}],errors:[{source:"Tracker",message:"failed"}],cards:[
    {title:"Straddle",evidence:"Option-candle replay",closed:3,open:2,unit:"days",capital:null,closedPnl:100,totalPnl:null,winRate:50,asOf:"2026-10-30",note:"Unresolved days"},
    {title:"Private position",evidence:"Manually recorded"},
  ]};
  const answer=applicationAnswer("performance",1,report);
  assert.ok(answer.sections.some(s=>s.title==="Straddle"&&s.lines.some(l=>l.includes("total P&L: Not available"))));
  assert.ok(!answer.sections.some(s=>s.title==="Private position"));
  assert.ok(answer.sections.some(s=>s.title==="Source failures"));
  assert.ok(applicationAnswer("operations",1,report).sections.some(s=>s.lines.some(l=>l.includes("Quota reached"))));
  assert.match(applicationAnswer("strategy",1).summary,/Blue Sky/);
  assert.throws(()=>applicationAnswer("operations",1),/required/);
});
