import './style.css';
import { ARC_CONFIGURED, arcJobState, connectArc, fundArcJob, refundArcJob } from './arc.js';
import { arcPanelState } from './arc-ui-state.js';

const API='/api/v1', JOB_ID=__TASKLATCH_JOB_ID__, OPPORTUNITY_JOB_ID='proofpay-opportunities-20260927-01';
const requestedTab=new URLSearchParams(location.search).get('tab');
let tab=['inbox','receipts','api'].includes(requestedTab)?requestedTab:'inbox',results=[],job=null,apiMode='testnet-setup-required',readinessMessage='',arcFunded=false;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function api(path,opt={}){
 const r=await fetch(API+path,{headers:{'content-type':'application/json'},...opt});
 const d=await r.json();if(!r.ok)throw Error(d.error||'Request failed');return d;
}
const tm=s=>new Date(s).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});
const dateTime=s=>s?new Date(s).toLocaleString():'Unknown';
const shortAddress=s=>s&&s.length>14?`${s.slice(0,6)}…${s.slice(-4)}`:s||'Not configured';
const amount=s=>Number(s||0).toFixed(2);
const testnetReady=()=>ARC_CONFIGURED&&apiMode==='arc-testnet';
async function load(){const jobs=await api('/jobs');job=jobs.data?.find(x=>x.id===JOB_ID)||null;if(!job)throw Error(`Configured fixture job ${JOB_ID} was not returned by the API; refusing to display or fund a different job.`);const response=await api(`/jobs/${encodeURIComponent(job.id)}/results`);results=response.data;apiMode=response.mode;readinessMessage=response.readinessMessage||'';render();}

function render(){
 const ready=testnetReady(),latest=[...results].sort((a,b)=>new Date(b.submittedAt)-new Date(a.submittedAt))[0];
 const unit=Number(job?.unitPrice||0),cap=unit*Number(job?.maxUnits||0);
 const criteria=job?.criteria||{};
 const latestDecision=latest?.decision;
 const latestLabel=latest?.version===2?'Agentic result':'Policy-only protocol test';
 document.querySelector('#app').innerHTML=`
 <header class="topbar"><div class="brand"><b>t.</b> TaskLatch</div><div class="header-status"><span class="network">ARC TESTNET</span><span class="operator-state">HISTORICAL TECHNICAL FIXTURE</span></div></header>
 <main>
   <section class="intro"><div><small class="eyebrow">BOUNDED PAYMENT FOR DELIVERED WORK</small><h1>Pay only for work that passes.</h1><p>A buyer funds one capped job. TaskLatch checks each submitted result against the buyer's criteria and pays accepted work in USDC.</p></div><div class="intro-proof"><b>Latest verified outcome</b><strong>${latestDecision?.outcome==='accepted'?`${amount(latestDecision.payment?.amount)} test USDC paid`:latestDecision?esc(latestDecision.outcome.toUpperCase()):'No result yet'}</strong><small>${esc(latestLabel)}${latest?` · ${esc(latest.company)}`:''}</small>${latestDecision?.payment?.explorerUrl?`<a href="${esc(latestDecision.payment.explorerUrl)}" target="_blank" rel="noreferrer">View Arc transaction ↗</a>`:''}</div></section>
   <section class="overview"><aside id="job-card" class="job-card"><div class="section-kicker">BUYER REQUEST <span>HISTORICAL TECHNICAL FIXTURE — POLICY-ONLY TEST</span></div><h2>${esc(job?.title||'Job unavailable')}</h2><p>${esc(job?.description||'The API has not returned a job.')}</p><div class="job-economics"><div><small>OUTPUTS</small><strong>${esc(job?.maxUnits||0)}</strong></div><div><small>PER ACCEPTED RESULT</small><strong>${amount(unit)} <span>test USDC</span></strong></div><div><small>MAXIMUM CAP</small><strong>${amount(cap)} <span>test USDC</span></strong></div></div><div class="job-detail"><b>Current test criteria</b><p>${esc(criteria.categoryIncludes||'—')} · at least ${esc(criteria.minEmployees||'—')} employees · ${esc(criteria.evidenceRule||'—')}</p></div><div class="job-detail"><b>Provider</b><code title="${esc(job?.providerWallet||'')}">${esc(shortAddress(job?.providerWallet))}</code></div><div class="authority"><b>Agent authority</b><p>Can evaluate results and release the fixed payment. Cannot change provider, unit price, or job cap.</p></div></aside><div class="overview-side"><article class="latest-card"><div class="section-kicker">LATEST FIXTURE RESULT</div>${latest?`<h2>${esc(latest.company)}</h2><p>${esc(latest.domain)} · submitted ${esc(dateTime(latest.submittedAt))}</p><div class="latest-outcome"><b class="${latestDecision?.outcome==='accepted'?'accepted':latestDecision?.outcome==='rejected'?'rejected':''}">${latestDecision?.outcome==='accepted'?'PAID':latestDecision?.outcome==='rejected'?'REJECTED':latestDecision?'HUMAN REVIEW':'PENDING'}</b><strong>${latestDecision?.outcome==='accepted'?`${amount(latestDecision.payment?.amount)} test USDC`:latestDecision?'0.00 test USDC':'Awaiting decision'}</strong></div><small>${esc(latestLabel)}${latest?.version===2?' · See sources and reasoning below.':' · Policy-only check; provider claims were not independently verified.'}</small>${latestDecision?.receiptHash?`<a class="link jump-receipt" href="?tab=receipts#content">Read fixture receipt ↗</a>`:''}`:'<p>No fixture result has been submitted.</p>'}</article><div class="scope-note"><b>Real operator run</b><p><a href="/operator-run.html">Open Anand's evidence-backed opportunity research and Arc Testnet receipt ↗</a></p></div></div></section>
   <nav aria-label="TaskLatch sections">${[['inbox','Results'],['receipts','Decision receipts'],['api','Agent API']].map(([id,label])=>`<a href="?tab=${id}#content" class="${tab===id?'selected':''}" ${tab===id?'aria-current="page"':''}>${label}</a>`).join('')}</nav>
   ${ready?'':`<p class="notice"><b>${apiMode==='testnet-role-conflict'?'Testnet payments paused.':'Testnet setup required.'}</b> ${esc(readinessMessage||'The configured payout path is not ready.')}</p>`}
   <section id="content"></section><footer>TaskLatch · historical Arc Testnet technical fixture <span><a href="/operator-run.html">Opportunity research run</a></span></footer>
 </main><div id="toast"></div>`;
 if(tab==='inbox')inbox();if(tab==='receipts')receiptPage();if(tab==='api')agentPage();
 setupArcPanel();
}

function card(r){
 if(r.version===2)return cardAgentic(r);
 const e=r.evaluation,d=r.decision,a=r.agentReview,s=r.settlement;
 const status=d?`<div class="final ${d.outcome}">${d.outcome==='accepted'?'✓ Paid':'× Rejected'} · ${tm(d.decidedAt)}</div><div class="receipt"><small>${esc(d.payment.status)}</small>${d.payment.txHash?`<small>ARC TESTNET TRANSACTION</small><code>${esc(d.payment.txHash)}</code>`:''}${d.payment.explorerUrl?`<a href="${esc(d.payment.explorerUrl)}" target="_blank" rel="noreferrer">View Arc Testnet transaction ↗</a>`:''}<small>LOCAL DECISION RECEIPT HASH</small><code>${esc(d.receiptHash)}</code></div>`:`<div class="notice"><b>${esc(s?.status||'awaiting settlement')}</b>${s?.message?`<p>${esc(s.message)}</p>`:''}${s?.txHash?`<code>${esc(s.txHash)}</code>`:''}</div>`;
 return `<article class="card"><div class="record-type">POLICY-ONLY TEST · NO INDEPENDENT AI JUDGMENT</div><div class="row"><div class="logo">${esc(r.company?.[0]||'?')}</div><div class="co"><b>${esc(r.company)}</b><small>${esc(r.domain)} · Submitted ${tm(r.submittedAt)}</small></div><strong class="price">${amount(job?.unitPrice)} <small>test USDC</small></strong></div><div class="record"><div><small>CATEGORY</small><b>${esc(r.category)}</b></div><div><small>EMPLOYEES</small><b>${esc(r.employeeCountAtLeast)}</b></div><a href="${esc(r.evidenceUrl)}" target="_blank" rel="noreferrer">Submitted URL ↗</a></div><div class="eval"><b>Rule evaluation</b><small> · job policy v1</small><label class="${e.eligible?'ok':'bad'}">${e.eligible?'POLICY CHECKS PASS':'DOES NOT PASS'}</label><ul>${e.checks.map(c=>`<li class="${c.pass?'pass':'fail'}">${c.pass?'✓':'×'} ${esc(c.label)}</li>`).join('')}</ul><small>Checks use submitted claims. The API checks the evidence URL's domain but does not verify the page content.</small></div><div class="agent-review"><b>Automated policy evaluator</b><strong class="${a.recommendation==='accept'?'accepted':'rejected'}"> recommends ${esc(a.recommendation)}</strong><p>${esc(a.rationale)}</p></div>${status}</article>`;
}

function cardAgentic(r){
 const d=r.decision,a=r.agentReview,e=r.evaluation,s=r.settlement,p=r.evidencePurchase;
 const sources=r.independentEvidence?.sources||[];
 return `<article class="card"><div class="row"><div class="logo">${esc(r.company?.[0]||'?')}</div><div class="co"><b>${esc(r.company)}</b><small>${esc(r.domain)} · Signed provider submission · ${tm(r.submittedAt)}</small></div><strong class="price">$0.02 <small>test USDC</small></strong></div><div class="eval"><b>Hard checks</b><label class="${e.eligible?'ok':'bad'}">${e.eligible?'PASS':'FAIL'}</label><ul>${e.checks.map(c=>`<li class="${c.pass?'pass':'fail'}">${c.pass?'✓':'×'} ${esc(c.label)}</li>`).join('')}</ul></div><div class="agent-review"><b>Independent evidence · ${esc(p?.status||'not purchased')}</b>${p?.payment?`<p>Circle x402 purchase: ${esc(p.payment.amount)} USDC on ${esc(p.payment.chain)} · ${esc(p.payment.service)}</p>`:''}${sources.length?`<ul>${sources.map(x=>`<li><a href="${esc(x.url)}" target="_blank" rel="noreferrer">${esc(x.title||x.url)}</a> · ${esc(x.provider)}</li>`).join('')}</ul>`:'<p>No independent source recorded.</p>'}<b>Buyer-agent judgment</b><strong>${esc(a?.recommendation||'PENDING')}</strong><p>${esc(a?.reason||'Awaiting evidence and model judgment.')}</p>${typeof a?.confidence==='number'?`<small>Confidence ${Math.round(a.confidence*100)}% · ${esc(a.model||a.agent)}</small>`:''}</div>${d?`<div class="final ${esc(d.outcome)}">${d.outcome==='accepted'?'✓ Paid':d.outcome==='rejected'?'× Rejected':'! Human review'} · ${tm(d.decidedAt)}</div><div class="receipt"><small>${esc(d.payment.status)} · ${esc(d.payment.amount)} USDC</small>${d.payment.txHash?`<small>ARC TESTNET SETTLEMENT TRANSACTION</small><code>${esc(d.payment.txHash)}</code><a href="${esc(d.payment.explorerUrl)}" target="_blank" rel="noreferrer">View Arc Testnet transaction ↗</a>`:''}<small>DECISION RECEIPT HASH</small><code>${esc(d.receiptHash)}</code></div>`:`<div class="notice"><b>${esc(s?.status||'processing')}</b>${s?.txHash?`<code>${esc(s.txHash)}</code>`:''}</div>`}</article>`;
}

function inbox(){
 const el=document.querySelector('#content');
 const hasUncertain=results.some(r=>['pending-verification','submitting'].includes(r.settlement?.status)||(r.settlement?.status==='needs-attention'&&r.settlement?.txHash));
 el.innerHTML=`<div class="heading"><div><h2>Historical submitted work</h2><p>This view preserves the earlier company-research payment fixture. <a href="/operator-run.html">The real operator run is here.</a></p></div><div><button id="refresh" class="link">Refresh</button> <button id="reconcile" class="link ${hasUncertain?'':'hidden'}">Reconcile chain receipt</button></div></div><div class="cards">${results.map(card).join('')}</div>${results.length?'':'<p class="empty">No results yet.</p>'}`;
 document.querySelector('#refresh').onclick=load;
 document.querySelector('#reconcile').onclick=async()=>{const button=document.querySelector('#reconcile');if(button.disabled)return;button.disabled=true;try{const {data}=await api(`/jobs/${encodeURIComponent(job.id)}/reconcile-pending`,{method:'POST'});await load();toast(data.some(x=>x.status==='confirmed')?'Confirmed receipt recovered from Arc Testnet':'No confirmed receipt yet; no transaction was resent')}catch(e){toast(e.message)}finally{button.disabled=false}};
}

function receiptCard(x){
 const r=results.find(y=>y.id===x.id),p=x.receiptPayload||{},submitted=p.submittedResult||r||{};
 const policyOnly=!x.agentReview?.model;
 const checks=p.evaluation?.checks||x.evaluation?.checks||[];
 const sources=p.independentEvidence?.sources||[];
 const purchase=p.x402EvidencePurchase?.payment;
 const recipient=x.payment?.recipient||r?.providerWallet||job?.providerWallet;
 return `<article class="card receipt-card">
  <div class="receipt-head"><div><small class="receipt-kicker">PROOFPAY DECISION RECEIPT</small><h3>${esc(submitted.company||r?.company||'Submitted result')}</h3><p>${esc(submitted.domain||r?.domain||'Domain unavailable')} · ${esc(dateTime(x.decidedAt))}</p></div><div class="receipt-outcome"><b class="${esc(x.outcome)}">${x.outcome==='accepted'?'ACCEPTED':x.outcome==='rejected'?'REJECTED':'HUMAN REVIEW'}</b><strong>${amount(x.payment?.amount)} test USDC</strong></div></div>
  <p class="receipt-disclosure">${policyOnly?'TEST FIXTURE — NOT OPERATOR VALIDATION. Checks used provider-submitted claims; page content was not independently verified and no AI judgment occurred.':sources.length?'Evidence-backed agent decision. Read the sources and model reasoning below.':'Agentic record has no independent sources; inspect the judgment before treating it as evidence-backed.'}</p>
  <div class="receipt-grid"><section><h4>1 · Buyer request and submission</h4><dl><dt>Job</dt><dd>${esc(job?.title||p.jobId||JOB_ID)}</dd><dt>Criteria</dt><dd>${esc(job?.description||'Unavailable')}</dd><dt>Job ID</dt><dd><code>${esc(p.jobId||JOB_ID)}</code></dd><dt>Result ID</dt><dd><code>${esc(x.id)}</code></dd><dt>Provider</dt><dd><code>${esc(recipient||'Unavailable')}</code></dd><dt>Submitted</dt><dd>${esc(dateTime(r?.submittedAt||submitted.submittedAt))}</dd></dl></section>
  <section><h4>2 · Hard checks</h4>${checks.length?`<ul class="receipt-checks">${checks.map(c=>`<li class="${c.pass?'pass':'fail'}">${c.pass?'✓':'×'} ${esc(c.label)}</li>`).join('')}</ul>`:'<p>No checks recorded.</p>'}</section>
  <section><h4>3 · Evidence</h4>${sources.length?`<ul class="receipt-sources">${sources.map(s=>`<li><a href="${esc(s.url)}" target="_blank" rel="noreferrer">${esc(s.title||s.url)}</a><small>${esc(s.provider||'Independent source')}</small></li>`).join('')}</ul>`:r?.evidenceUrl?`<p>Provider-submitted URL: <a href="${esc(r.evidenceUrl)}" target="_blank" rel="noreferrer">${esc(r.evidenceUrl)}</a></p><small>URL/domain check only; page content was not fetched for this receipt.</small>`:'<p>No independent evidence recorded.</p>'}${purchase?`<p class="receipt-purchase"><b>x402 evidence purchase</b><br>${esc(purchase.amount)} USDC · ${esc(purchase.service)} · ${esc(purchase.chain||'chain unrecorded')}${purchase.paymentId?`<br><code>${esc(purchase.paymentId)}</code>`:''}</p>`:''}</section>
  <section><h4>4 · Decision</h4><p><b>${policyOnly?'Deterministic policy':'AI judgment'}</b>${!policyOnly&&Number.isFinite(x.agentReview?.confidence)?` · ${Math.round(x.agentReview.confidence*100)}% confidence`:''}</p><p>${esc(x.agentReview?.reason||x.agentReview?.rationale||x.reason||'No reason recorded.')}</p>${!policyOnly?`<small>Model: ${esc(x.agentReview.model)}</small>`:''}</section></div>
  <div class="receipt-settlement"><h4>5 · Settlement</h4><dl><dt>Network</dt><dd>Arc Testnet</dd><dt>Status</dt><dd>${esc(x.payment?.status||'Unrecorded')}</dd><dt>Amount</dt><dd>${amount(x.payment?.amount)} test USDC</dd><dt>Recipient</dt><dd><code>${esc(recipient||'Unavailable')}</code></dd><dt>Arc Testnet transaction</dt><dd>${x.payment?.txHash?`<code>${esc(x.payment.txHash)}</code> <a href="${esc(x.payment.explorerUrl)}" target="_blank" rel="noreferrer">View on Arc ↗</a>`:'No payout transaction'}</dd><dt>Local decision receipt hash</dt><dd><code>${esc(x.receiptHash)}</code><small>Historical receipt record hash; distinct from the Arc transaction.</small></dd></dl></div>
 </article>`;
}

async function receiptPage(){
 const el=document.querySelector('#content');
 el.innerHTML='<p class="empty">Loading decision receipts…</p>';
 try{const d=(await api('/receipts')).data; if(tab!=='receipts')return;
  el.innerHTML=`<div class="heading"><div><h2>Decision receipts</h2><p>Read the buyer request, actual checks, judgment, and payment proof for each result. The local receipt hash is separate from the Arc transaction.</p></div></div>${d.length?`<div class="cards">${d.map(receiptCard).join('')}</div>`:'<p class="empty">No decisions yet.</p>'}`;
 }catch(e){if(tab==='receipts')el.innerHTML=`<p class="notice">Could not load receipts: ${esc(e.message)}</p>`;}
}

function agentPage(){
 document.querySelector('#content').innerHTML=`<div class="heading"><div><h2>Operator run API</h2><p>These routes expose the fixed opportunity research task. <a href="/operator-run.html">Open its decisions and receipt.</a></p></div><a class="link" href="/api/v1/openapi" target="_blank">OpenAPI schema ↗</a></div><div class="api-grid"><article>GET <code>/api/v1/jobs</code><p>List the configured opportunity job and historical fixture.</p></article><article>GET <code>/api/v1/jobs/${OPPORTUNITY_JOB_ID}</code><p>Read the operator request, fixed price, cap, and configured wallet roles.</p></article><article>POST <code>/api/v1/jobs/${OPPORTUNITY_JOB_ID}/results</code><p>Submit a signed identity and official URL for one of the three recorded candidates. TaskLatch fetches sources, runs hard checks and AI judgment, then persists a receipt.</p></article><article>GET <code>/api/v1/jobs/${OPPORTUNITY_JOB_ID}/results/{resultId}/receipt</code><p>Read the persisted evidence, checks, decision, payment status, and receipt hash.</p></article></div><p class="notice"><b>Scope</b> This is a fixed local operator run, not a general job-creation API. A submitted result is evaluated and persisted; this API route does not initiate settlement.</p>`;
}

async function setupArcPanel(){
 const aside=document.querySelector('#job-card');
 const roleConflict=apiMode==='testnet-role-conflict';
 if(!aside||(!testnetReady()&&!roleConflict))return;
 const box=document.createElement('details');box.className='arc-controls';box.innerHTML=`<summary>Buyer wallet actions</summary><div><button id="connect-arc" class="link">Connect buyer wallet</button><span id="arc-status">${roleConflict?'Payouts paused. Connect the buyer wallet to inspect the escrow and refund after expiry.':'Connect the buyer wallet to inspect the escrow.'}</span><button id="fund-arc" class="accept hidden">Fund $0.10 cap once</button><button id="refund-arc" class="link hidden">Refund unused cap after expiry</button></div>`;
 aside.append(box);
 const status=document.querySelector('#arc-status'),fund=document.querySelector('#fund-arc'),refund=document.querySelector('#refund-arc');
 const showState=state=>{
  arcFunded=state.funded;
  const controls=arcPanelState(state);
  status.textContent=controls.message;
  fund.classList.toggle('hidden',!controls.canFund);
  refund.classList.toggle('hidden',!controls.canRefund);
 };
 document.querySelector('#connect-arc').onclick=async event=>{const button=event.currentTarget;if(button.disabled)return;button.disabled=true;try{await connectArc();showState(await arcJobState(job));await load()}catch(e){status.textContent=e.message}finally{button.disabled=false}};
 fund.onclick=async()=>{if(fund.disabled)return;fund.disabled=true;try{const jobs=await api('/jobs'),fundingJob=jobs.data?.find(item=>item.id===job?.id);if(!fundingJob)throw Error(`Configured fixture job ${job?.id||JOB_ID} was not returned; no escrow was funded.`);const result=await fundArcJob(fundingJob);arcFunded=true;status.textContent='Buyer cap funded on Arc Testnet';fund.classList.add('hidden');toast(result.txHash?'Testnet cap confirmed':'Escrow was already funded');const settled=await api(`/jobs/${encodeURIComponent(job.id)}/settle-pending`,{method:'POST'});await load();toast(settled.data.some(x=>x.status==='confirmed')?'Pending eligible results settled':'Escrow ready for provider submissions')}catch(e){status.textContent=e.message}finally{fund.disabled=false}};
 refund.onclick=async()=>{if(refund.disabled)return;refund.disabled=true;try{const result=await refundArcJob(job.id);status.textContent='Unused cap refunded · '+result.txHash;refund.classList.add('hidden');toast('Arc Testnet refund confirmed')}catch(e){status.textContent=e.message}finally{refund.disabled=false}};
 try{showState(await arcJobState(job))}catch(e){status.textContent=e.message}
}

let timer;function toast(s){const e=document.querySelector('#toast');e.textContent=s;e.classList.add('show');clearTimeout(timer);timer=setTimeout(()=>e.classList.remove('show'),2400)}
load().catch(e=>document.querySelector('#app').textContent='Local API unavailable: '+e.message);
