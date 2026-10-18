// Read-only buyer-side policy/status client. It never submits results or pays.
const base=process.env.PROOFPAY_URL||'http://127.0.0.1:8787';
async function get(path){const r=await fetch(base+path);const d=await r.json();if(!r.ok)throw Error(d.error||r.statusText);return d}
const {data:[job],mode}=await get('/api/v1/jobs');
const {data:results}=await get('/api/v1/jobs/'+encodeURIComponent(job.id)+'/results');
console.log(`${job.title} · ${mode} · ${job.acceptedCount}/${job.maxUnits} paid`);
for(const r of results){
  const failed=(r.evaluation?.checks||[]).filter(c=>!c.pass).map(c=>c.label);
  console.log(`${r.company}: ${r.decision?.outcome||r.agentReview?.recommendation||'pending'}; ${r.settlement?.status||'not settled'}${failed.length?'; failed: '+failed.join(', '):''}`);
  if(r.decision?.payment?.explorerUrl)console.log(`  ${r.decision.payment.amount} test USDC · ${r.decision.payment.explorerUrl}`);
}
