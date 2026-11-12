/* Nonzero per-request prices must never look free after currency formatting. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
(async()=>{
const {money}=await import('../../frontend/src/domain/evidence.js');
for(const value of [2e-7,1.7e-8,5e-12,Number.MIN_VALUE,-2e-7]) {
  const text=money(value);
  const observed=Number.parseFloat(text);
  assert.ok(Number.isFinite(observed)&&observed!==0,'Nonzero rate displayed as zero: '+text);
  assert.equal(Math.sign(observed),Math.sign(value));
  assert.ok(text.includes('USD'));
}
assert.equal(money(NaN),'Unavailable');assert.equal(money(Infinity),'Unavailable');
console.log('PASS tiny nonzero rates, signed deltas and unavailable values preserve their meaning');

})().catch(e=>{console.error(e);process.exitCode=1;});
