/* Actual engine cost evidence verifies the UI never promotes unrelated rates. */
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
(async()=>{
const {costRateEvidence}=await import('../../frontend/src/domain/evidence.js');
const context={renderRateEvidence:costRateEvidence};
const record={id:'synthetic-token-quote',currency:'USD',unit:'USD / million tokens',input_per_million:.2,output_per_million:.6,source:'https://example.com/synthetic',provenance:'provider-published',applied_fields:['input_cost_per_million','output_cost_per_million']};
const project={id:'rate-evidence',name:'Synthetic source fixture',nodes:[{id:'service',label:'Service',type:'api_service',x:0,y:0,config:{capacity_rps:100,latency_ms:10,input_cost_per_million:.2,output_cost_per_million:.6,pricing_provenance:record}}],edges:[],scenario:{duration:2,rps:2,seed:42,events:[]},monthly:{hours:730,traffic_multiplier:1}};
const evidence=[];
function run(name,edit,check){const p=structuredClone(project);edit(p.nodes[0].config);const r=spawnSync('python3',['-c','import json,sys; from tds.simulation import simulate; print(json.dumps(simulate(json.load(sys.stdin))))'],{input:JSON.stringify(p),encoding:'utf8'});assert.equal(r.status,0,r.stderr);const cost=JSON.parse(r.stdout).costs[0],text=context.renderRateEvidence(cost);check(cost,text);evidence.push({name,cost,text,passed:true});console.log('PASS '+name);}
run('Token quote leaves omitted hourly cost an illustrative default',()=>{},(c,t)=>{assert.equal(c.rate_sources.hourly_cost.kind,'illustrative default');assert.equal(c.rate_sources.input_cost_per_million.kind,'provider-published quote');assert.match(t,/Hourly cost:.*illustrative default/);assert.match(t,/Input cost per million:.*provider-published quote/);assert.match(t,/Illustrative defaults: Hourly cost/);});
run('Manual hourly edit remains an estimate beside published token quote',c=>c.hourly_cost=9,(c,t)=>{assert.equal(c.rate_sources.hourly_cost.kind,'manual estimate');assert.match(t,/Hourly cost: 9 USD\/hour · manual estimate/);});
run('Manual token edit loses published status for that rate only',c=>c.input_cost_per_million=.7,(c,t)=>{assert.equal(c.rate_sources.input_cost_per_million.kind,'manual estimate');assert.equal(c.rate_sources.output_cost_per_million.kind,'provider-published quote');assert.match(t,/Input cost per million: 0.7 USD\/million input tokens · manual estimate/);});
assert.match(context.renderRateEvidence({provenance:record}),/Per-rate source verification unavailable; rates are estimates/);
fs.writeFileSync('web/evidence/rate-provenance.json',JSON.stringify({generated_at:new Date().toISOString(),evidence,limits:'Synthetic source metadata and engine interoperability only; no real provider quote or production accuracy verified.'},null,2));

})().catch(e=>{console.error(e);process.exitCode=1;});
