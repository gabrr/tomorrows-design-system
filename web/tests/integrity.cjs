/* Dependency-free boundary regressions for the browser implementation.
   Uses real simulator output as the valid oracle, then injects contradictory evidence. */
const fs=require('node:fs');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
(async()=>{
const pure=await import('../../frontend/src/domain/evidence.js');
const fences=await import('../../frontend/src/domain/fence.js');
const state={identity:0,revision:0};
const t={...pure,state,captureWorkspace:()=>fences.captureFence(state),sameWorkspace:(f,exact=true)=>fences.sameFence(state,f,exact),requireWorkspace:f=>fences.requireFence(state,f)},checks=[];
const project={id:'integrity-fixture',name:'Integrity fixture',nodes:[{id:'shared',type:'api_service',label:'Service',x:0,y:0,config:{latency_ms:20,capacity_rps:100,hourly_cost:0.1}}],edges:[],scenario:{duration:5,seed:42,rps:2,events:[]},monthly:{hours:730,traffic_multiplier:1}};
const actual=spawnSync('python3',['-c','import json,sys; from tds.simulation import simulate; print(json.dumps(simulate(json.load(sys.stdin))))'],{input:JSON.stringify(project),encoding:'utf8'});assert.equal(actual.status,0,actual.stderr);const result=JSON.parse(actual.stdout);
function test(name,fn){fn();checks.push({name,passed:true});console.log('PASS '+name);}
function reject(name,edit){test(name,()=>{const r=structuredClone(result);edit(r);assert.throws(()=>t.validateResult(r,project));});}
test('Real seeded simulator output accepted',()=>t.validateResult(result,project));
for(const key of ['costs','events','assumptions']) reject('Missing '+key+' evidence rejected before rendering',r=>delete r[key]);
reject('Positive cost evidence with empty breakdown rejected',r=>r.costs=[]);
test('Zero cost evidence with empty breakdown accepted',()=>{const p=structuredClone(project);p.nodes[0].config.hourly_cost=0;const actualZero=spawnSync('python3',['-c','import json,sys;from tds.simulation import simulate;print(json.dumps(simulate(json.load(sys.stdin))))'],{input:JSON.stringify(p),encoding:'utf8'});assert.equal(actualZero.status,0,actualZero.stderr);const r=JSON.parse(actualZero.stdout);assert.equal(r.summary.experiment_cost,0);assert.equal(r.summary.monthly_cost,0);r.costs=[];t.validateResult(r,p);});
reject('Empty frame evidence rejected',r=>r.frames=[]);
reject('Unordered timestamps rejected',r=>r.frames[2].time=r.frames[1].time);
reject('Missing final frame rejected',r=>r.frames.pop());
reject('Nonfinite frame timestamps rejected',r=>r.frames[1].time=Infinity);
reject('String summary numbers rejected',r=>r.summary.p95_ms='20');
reject('Boolean summary numbers rejected',r=>r.summary.failed=false);
reject('Nonfinite summary numbers rejected',r=>r.summary.p95_ms=NaN);
reject('Foreground conservation contradiction rejected',r=>r.summary.requests++);
reject('Availability contradiction rejected',r=>r.summary.availability=.2);
reject('Background conservation contradiction rejected',r=>r.summary.background_pending++);
reject('Node telemetry strings rejected',r=>r.frames[0].nodes.shared.queue_depth='0');
reject('Missing node telemetry rejected',r=>delete r.frames[0].nodes.shared);
reject('Unknown telemetry target rejected',r=>r.frames[0].nodes.other={...r.frames[0].nodes.shared});
reject('Architecture snapshot mismatch rejected',r=>r.project.nodes[0].config.latency_ms=10);
reject('Second contradictory embedded snapshot rejected',r=>{r.project_snapshot=structuredClone(project);r.project.nodes[0].x=100;});
reject('Seed mismatch rejected',r=>r.seed=99);
reject('Out-of-range timestamps rejected',r=>r.frames.at(-1).time=6);
reject('Negative telemetry rejected',r=>r.frames[0].nodes.shared.utilization=-1);
reject('Unordered percentiles rejected',r=>r.summary.p50_ms=1000);
reject('Reconciled but fabricated background summary rejected',r=>{r.summary.background_jobs=100;r.summary.background_completed=100;r.summary.background_failed=0;r.summary.background_pending=0;});
for(const key of ['queue_depth','inflight','received','started','completed','failed','cache_hits','cache_misses','replicas'])reject('Fractional node '+key+' rejected',r=>r.frames[0].nodes.shared[key]=0.5);
reject('Observed failure with nonexistent target rejected',r=>r.events.push({time:1,type:'fail',target:'missing'}));
reject('Observed traffic with node target rejected',r=>r.events.push({time:1,type:'traffic',target:'shared'}));
reject('Observed unsupported event rejected',r=>r.events.push({time:1,type:'invented',target:'shared'}));
test('Valid observed global traffic and node failure accepted',()=>{const r=structuredClone(result);r.events.push({time:1,type:'traffic',target:'global'},{time:2,type:'fail',target:'shared'});t.validateResult(r,project);});
test('Nearest frame uses actual irregular timestamps and resolves ties earlier',()=>{const frames=[{time:0},{time:.3},{time:2},{time:5}];assert.equal(t.nearestFrame(.4,frames),1);assert.equal(t.nearestFrame(3.5,frames),2);assert.equal(t.nearestFrame(5,frames),3);});
test('Actual async run accepts background totals and rejects fractional connection counts',()=>{const asyncProject=structuredClone(project);asyncProject.nodes.push({...structuredClone(project.nodes[0]),id:'worker'});asyncProject.edges.push({id:'async-edge',source:'shared',target:'worker',latency_ms:0,weight:1,async:true});const run=spawnSync('python3',['-c','import json,sys; from tds.simulation import simulate; print(json.dumps(simulate(json.load(sys.stdin))))'],{input:JSON.stringify(asyncProject),encoding:'utf8'});assert.equal(run.status,0,run.stderr);const output=JSON.parse(run.stdout);assert.ok(output.summary.background_jobs>0);t.validateResult(output,asyncProject);for(const key of ['requests','delivered','failed','inflight']){const bad=structuredClone(output);bad.frames[0].edges['async-edge'][key]=.5;assert.throws(()=>t.validateResult(bad,asyncProject),/integer count/);}});
test('USD hourly unit conflict unavailable',()=>assert.match(t.priceReason({id:'bad',provider:'azure',currency:'USD',hourly_cost:3,unit:'GB-month'}),/conflicts/));
test('Missing currency unavailable',()=>assert.match(t.priceReason({id:'bad',provider:'azure',hourly_cost:3,unit:'instance-hour'}),/USD currency/));
test('Correct token rate supported',()=>assert.equal(t.priceReason({id:'valid',provider:'openrouter',currency:'USD',input_per_million:.2,output_per_million:1,request_cost:0.002,unit:'USD / million tokens'}),''));
test('Unknown measurement target rejected',()=>assert.throws(()=>t.validateMeasurements([{node_id:'missing',source:'fixture',samples_ms:Array(10).fill(20)}],project)));
test('Short, string and nonfinite service samples rejected',()=>{for(const samples of [Array(9).fill(20),[...Array(9).fill(20),'20'],[...Array(9).fill(20),Infinity]])assert.throws(()=>t.validateMeasurements([{node_id:'shared',source:'fixture',samples_ms:samples}],project));});
test('Capacity never inferred from latency',()=>{const values=[{node_id:'shared',source:'fixture',samples_ms:Array(10).fill(20)}];const accepted=t.validateMeasurements(values,project);assert.equal('capacity_rps' in accepted[0],false);});
test('Workspace identity fences even identical revision and node IDs',()=>{t.state.identity=1;t.state.revision=5;const f=t.captureWorkspace();assert.equal(t.sameWorkspace(f),true);t.state.identity=2;assert.equal(t.sameWorkspace(f,false),false);assert.throws(()=>t.requireWorkspace(f));});
test('Same workspace revisions invalidate proposals',()=>{t.state.identity=3;t.state.revision=5;const f=t.captureWorkspace();t.state.revision++;assert.equal(t.sameWorkspace(f),false);assert.equal(t.sameWorkspace(f,false),true);});
fs.writeFileSync('web/integrity-evidence.json',JSON.stringify({generated_at:new Date().toISOString(),checks,oracle:'Actual tds.simulation.simulate output, seed 42, synthetic service station; no empirical accuracy claim.'},null,2));

})().catch(e=>{console.error(e);process.exitCode=1;});
