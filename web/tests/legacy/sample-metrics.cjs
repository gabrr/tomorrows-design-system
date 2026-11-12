/* Real engine/browser regression for sample-aware result presentation.
   Uses only a disposable backend supplied by TDS_UI_URL; no mocked run responses. */
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs/promises');
const assert=require('node:assert/strict');
(async()=>{
 const base=process.env.TDS_UI_URL;if(!base)throw new Error('Set TDS_UI_URL to a fresh disposable backend');
 const browser=await chromium.launch({headless:true});
 const page=await browser.newPage({viewport:{width:1360,height:768},reducedMotion:'reduce'});
 const evidence={base_url:base,browser:browser.version(),generated_at:new Date().toISOString(),cases:[],errors:[],limits:['Seeded synthetic workloads through the actual local engine, not production measurements.','Chromium only; no screen-reader audit.']};
 page.on('pageerror',e=>evidence.errors.push(e.message));page.on('dialog',d=>d.accept());
 let passed=false;
 try{
 await page.goto(base);await page.locator('.node').first().waitFor();await page.locator('#experiment-toggle').click();
 const fixture={id:'sample-metrics',name:'Sample-aware readings',nodes:[{id:'service',type:'api_service',label:'Service',x:100,y:50,config:{capacity_rps:100,latency_ms:10,concurrency:100,queue_limit:1000,hourly_cost:.1}}],edges:[],scenario:{duration:2,rps:2,seed:42,events:[]},monthly:{hours:730,traffic_multiplier:1}};
 async function run(name,rps){
   await page.locator('#scenario-tab').click();await page.locator('#rps').fill(String(rps));await page.locator('#rps').press('Tab');
   const response=page.waitForResponse(r=>r.url()===base+'/api/simulate'&&r.request().method()==='POST');
   await page.locator('#run-btn').click();const res=await response;assert.equal(res.status(),200);const result=await res.json();
   await page.waitForFunction(()=>!document.querySelector('#run-btn').disabled);await page.locator('.horizon-stage').waitFor();
   const reading=await page.locator('#results-panel').evaluate(root=>({stage:root.querySelector('.horizon-stage').innerText,cards:[...root.querySelectorAll('.metric')].map(c=>({label:c.querySelector('span').textContent,value:c.querySelector('strong').textContent,text:c.innerText}))}));
   const s=result.summary,availability=reading.cards[0],latencies=reading.cards.slice(1,4);
   assert.equal(availability.value,s.requests>0?(s.availability*100).toLocaleString(undefined,{maximumFractionDigits:2})+'%':'Unavailable');
   for(const [i,key] of ['p50_ms','p95_ms','p99_ms'].entries())assert.equal(latencies[i].value,s.completed>0?s[key].toLocaleString(undefined,{maximumFractionDigits:1})+' ms':'Unavailable');
   if(s.completed===0){assert.match(reading.stage,/Unavailable/);assert.match(reading.stage,/No observations: no completed requests/);for(const c of latencies)assert.doesNotMatch(c.text,/vs previous/);}
   const entry={name,summary:s,reading};evidence.cases.push(entry);await fs.writeFile(`web/evidence/sample-${name}-run.json`,JSON.stringify(result,null,2));
   return entry;
 }
 for(const [name,config] of [['successful',{latency_ms:10}],['all-failed',{initial_state:'down'}],['all-pending',{latency_ms:10000}],['zero-latency',{latency_ms:0}]]){
   const project=structuredClone(fixture);project.name='Sample-aware '+name;Object.assign(project.nodes[0].config,config);
   await page.locator('#import-file').setInputFiles({name:name+'.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(project))});await page.waitForFunction(name=>document.querySelector('#project-name').value===name,project.name);
   const observed=await run(name+'-observed',2);assert.ok(observed.summary.requests>0);
   if(name==='all-failed')assert.equal(observed.summary.failed,observed.summary.requests);
   if(name==='all-pending')assert.equal(observed.summary.pending,observed.summary.requests);
   if(name==='zero-latency'){assert.ok(observed.summary.completed>0);assert.equal(observed.reading.cards[2].value,'0 ms');assert.match(observed.reading.stage,/0 ms/);}
   await page.screenshot({path:`web/evidence/sample-${name}.png`,fullPage:true});
   const empty=await run(name+'-zero-traffic',0);assert.equal(empty.summary.requests,0);for(const c of empty.reading.cards.slice(0,4)){assert.equal(c.value,'Unavailable');assert.doesNotMatch(c.text,/vs previous/);assert.match(c.text,/Comparison unavailable/);}
   if(name==='successful')await page.screenshot({path:'web/evidence/sample-zero-traffic.png',fullPage:true});
   const after=await run(name+'-after-empty',2);for(const c of after.reading.cards.slice(0,4)){assert.doesNotMatch(c.text,/vs previous/);assert.match(c.text,/Comparison unavailable/);}
   const repeated=await run(name+'-repeated',2);assert.match(repeated.reading.cards[0].text,/vs previous/);for(const c of repeated.reading.cards.slice(1,4)){if(repeated.summary.completed>0)assert.match(c.text,/vs previous/);else assert.doesNotMatch(c.text,/vs previous/);}
   console.log('PASS '+name+': real engine counts, unavailable readings, both comparison directions and repeated sampled runs');
 }
 assert.deepEqual(evidence.errors,[]);passed=true;
 }finally{evidence.status=passed?'passed':'failed';await fs.writeFile('web/evidence/sample-metrics.json',JSON.stringify(evidence,null,2));await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
