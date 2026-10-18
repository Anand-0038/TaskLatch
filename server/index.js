import { createServer } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { Contract, Interface, JsonRpcProvider, Wallet, getAddress, isAddress, keccak256 } from 'ethers';
import { jobIdBytes32, resultIdBytes32, evidenceHash, ARC_TESTNET_CHAIN_ID, requireArcTestnetRpc, ARC_TESTNET_USDC, ARC_EXPLORER } from '../shared/evidence.js';
import { assertCircleSession, buyExaEvidence, EVIDENCE_BUDGET_ATOMIC, EXA_SEARCH_COST_ATOMIC, hardChecks, hasCompanyDomain, judgeWithGroq, reserveUniqueCompanyDomain, verifyProviderSubmission } from './agentic.js';
import { createOpportunityService, OPPORTUNITY_RUN_ID } from './opportunity-service.js';
import { handleOpportunityRoute } from './opportunity-api.js';
import { buildOpenApi } from './openapi.js';
import { contentTypeForPath, readJsonBody, resolveApiPort, resolveJobId } from './http-utils.js';

const port = resolveApiPort(process.env.API_PORT);
const rows = [];
const jobId=resolveJobId(process.env.PROOFPAY_JOB_ID||process.env.VITE_PROOFPAY_JOB_ID);
const buyerSecret=process.env.ARC_TESTNET_PRIVATE_KEY||'';
const buyerDerived=(()=>{try{return buyerSecret?new Wallet(buyerSecret).address:''}catch{return ''}})();
const buyerCandidate=process.env.PROOFPAY_BUYER_ADDRESS||buyerDerived;
const configuredBuyer=isAddress(buyerCandidate)?getAddress(buyerCandidate):'';
const job = { id:jobId, title:'Company research result purchase', description:'Submit a real B2B SaaS company record with evidence from its own website.', unitPrice:'0.02', unitPriceAtomic:'20000', maxUnits:5, acceptedCount:0, status:'open', criteria:{categoryIncludes:'B2B SaaS',minEmployees:20,evidenceRule:'HTTPS URL on the company domain'}, provider:'configured-provider',providerWallet:process.env.PROOFPAY_PROVIDER_ADDRESS||'',buyerWallet:configuredBuyer };
const jobPath=`/api/v1/jobs/${encodeURIComponent(job.id)}`;
const decisions = new Map(), agentReviews = new Map(), receipts = [];
const stateDir=new URL('../.local/',import.meta.url),stateName=jobId==='job-demo-001'?'proofpay-state.json':`proofpay-state-${jobId}.json`,stateFile=new URL('../.local/'+stateName,import.meta.url),stateTemp=new URL('../.local/'+stateName.replace(/\.json$/,'.tmp'),import.meta.url);
let saveQueue=Promise.resolve();
const isFixture=r=>String(r.domain||'').toLowerCase().endsWith('.example')||(()=>{try{return new URL(r.evidenceUrl).hostname==='example.com'}catch{return false}})();
async function restoreState(){try{const saved=JSON.parse(await readFile(stateFile,'utf8')),savedRows=Array.isArray(saved.rows)?saved.rows:[],fixtureIds=new Set(savedRows.filter(isFixture).map(r=>r.id));rows.splice(0,rows.length,...savedRows.filter(r=>!isFixture(r)));for(const [k,v] of saved.decisions||[])if(!fixtureIds.has(k))decisions.set(k,v);for(const [k,v] of saved.agentReviews||[])if(!fixtureIds.has(k))agentReviews.set(k,v);receipts.push(...(saved.receipts||[]).filter(r=>!fixtureIds.has(r.id)));job.acceptedCount=fixtureIds.size?[...decisions.values()].filter(d=>d.outcome==='accepted').length:(Number.isInteger(saved.acceptedCount)?saved.acceptedCount:0);console.log(`Restored ${rows.length} real-result record(s) from local state; discarded ${fixtureIds.size} synthetic fixture(s)`);if(fixtureIds.size)await persistState()}catch(e){if(e.code!=='ENOENT')throw e}}
function persistState(){const data=JSON.stringify({rows,acceptedCount:job.acceptedCount,decisions:[...decisions],agentReviews:[...agentReviews],receipts});const next=saveQueue.catch(()=>{}).then(async()=>{await mkdir(stateDir,{recursive:true});await writeFile(stateTemp,data);await rename(stateTemp,stateFile)});saveQueue=next;return next}
await restoreState();
const digest = x => '0x' + createHash('sha256').update(JSON.stringify(x)).digest('hex');
const onchain = new Interface(['event ResultResolved(bytes32 indexed jobId,bytes32 indexed resultId,bool accepted,bytes32 evidenceHash,uint256 amount)','function jobs(bytes32) view returns(address buyer,address provider,address agent,uint128 unitPrice,uint32 maxUnits,uint32 accepted,uint64 expiresAt,bool exists)','function usdc() view returns(address)']);
const liveEscrow = process.env.PROOFPAY_ESCROW_ADDRESS || '';
const agentSecret = process.env.ARC_TESTNET_AGENT_PRIVATE_KEY || '';
const configuredAgent = process.env.PROOFPAY_AGENT_ADDRESS || '';
const derivedAgent=(()=>{try{return agentSecret?new Wallet(agentSecret).address:''}catch{return ''}})();
const agentReady=Boolean(configuredAgent&&derivedAgent&&configuredAgent.toLowerCase()===derivedAgent.toLowerCase());
let apiMode=liveEscrow&&agentReady&&configuredBuyer&&job.providerWallet?'arc-testnet':'testnet-setup-required';
let readinessMessage='';
if(apiMode==='arc-testnet'){
  try{
    const chain=new JsonRpcProvider(requireArcTestnetRpc(process.env)),network=await chain.getNetwork();
    if(network.chainId!==ARC_TESTNET_CHAIN_ID)throw Error('Configured RPC is not Arc Testnet.');
    const reader=new Contract(liveEscrow,['function jobs(bytes32) view returns(address buyer,address provider,address agent,uint128 unitPrice,uint32 maxUnits,uint32 accepted,uint64 expiresAt,bool exists)'],chain),funded=await reader.jobs(jobIdBytes32(job.id));
    if(funded.exists&&(funded.buyer.toLowerCase()!==configuredBuyer.toLowerCase()||funded.buyer.toLowerCase()===funded.provider.toLowerCase()||funded.buyer.toLowerCase()===funded.agent.toLowerCase()||funded.provider.toLowerCase()===funded.agent.toLowerCase())){
      apiMode='testnet-role-conflict';readinessMessage='This funded job does not match the configured buyer and distinct-wallet requirements. No settlement will be sent.';
    }
  }catch{apiMode='testnet-setup-required';readinessMessage='Arc Testnet readiness could not be verified. Check the local RPC, escrow, and wallet configuration.'}
}
let settlementQueue=Promise.resolve();
let agenticQueue=Promise.resolve();
async function verifyArcResolution(txHash,id,action,row,evaluation,agentReview){
  if(!liveEscrow)throw Error('Arc escrow address is not configured on the API server.');
  if(!/^0x[0-9a-fA-F]{64}$/.test(txHash||''))throw Error('A confirmed Arc Testnet transaction hash is required.');
  const provider=new JsonRpcProvider(requireArcTestnetRpc(process.env)),network=await provider.getNetwork();
  if(network.chainId!==ARC_TESTNET_CHAIN_ID)throw Error('API RPC is not Arc Testnet; refusing to record settlement.');
  const escrow=liveEscrow.toLowerCase(),receipt=await provider.getTransactionReceipt(txHash),tx=await provider.getTransaction(txHash);
  if(!receipt||receipt.status!==1||!tx||tx.to?.toLowerCase()!==escrow)throw Error('Transaction is missing, failed, or targets a different contract.');
  const jobHash=jobIdBytes32(job.id),resultHash=resultIdBytes32(id),expectedHash=evidenceHash(job.id,row,evaluation,agentReview);
  const reader=new Contract(liveEscrow,['function jobs(bytes32) view returns(address buyer,address provider,address agent,uint128 unitPrice,uint32 maxUnits,uint32 accepted,uint64 expiresAt,bool exists)','function usdc() view returns(address)'],provider),jobState=await reader.jobs(jobHash);
  if(!job.providerWallet||!configuredBuyer||!jobState.exists||jobState.buyer.toLowerCase()!==configuredBuyer.toLowerCase()||jobState.agent.toLowerCase()!==configuredAgent.toLowerCase()||jobState.agent.toLowerCase()!==tx.from.toLowerCase()||jobState.provider.toLowerCase()!==job.providerWallet.toLowerCase()||jobState.unitPrice!==BigInt(job.unitPriceAtomic)||jobState.maxUnits!==BigInt(job.maxUnits))throw Error('Confirmed transaction sender or escrow job terms do not match the configured buyer, agent, provider, price, or cap.');
  const usdc=reader;
  if((await usdc.usdc()).toLowerCase()!==(process.env.ARC_USDC_ADDRESS||ARC_TESTNET_USDC).toLowerCase())throw Error('Escrow is configured for a different token than Arc Testnet USDC.');
  const expectedAccepted=action==='accept',expectedAmount=expectedAccepted?BigInt(job.unitPriceAtomic):0n;
  const found=receipt.logs.some(log=>{if(log.address.toLowerCase()!==escrow)return false;try{const parsed=onchain.parseLog(log);return parsed?.name==='ResultResolved'&&parsed.args.jobId.toLowerCase()===jobHash.toLowerCase()&&parsed.args.resultId.toLowerCase()===resultHash.toLowerCase()&&parsed.args.accepted===expectedAccepted&&parsed.args.evidenceHash.toLowerCase()===expectedHash.toLowerCase()&&parsed.args.amount===expectedAmount}catch{return false}});
  if(!found)throw Error('Arc transaction does not contain the expected job/result/decision/evidence event.');
  return {txHash:receipt.hash,blockNumber:Number(receipt.blockNumber),explorerUrl:ARC_EXPLORER+'/tx/'+receipt.hash,evidenceHash:expectedHash,acceptedUnits:Number(jobState.accepted)};
}
async function settleAcceptedResult(row,evaluation,agentReview,onBroadcast){
  if(!liveEscrow||!agentReady)return {status:'testnet-setup-required'};
  const provider=new JsonRpcProvider(requireArcTestnetRpc(process.env)),network=await provider.getNetwork();
  if(network.chainId!==ARC_TESTNET_CHAIN_ID)throw Error('Settlement RPC is not Arc Testnet; refusing to pay.');
  const signer=new Wallet(agentSecret,provider);
  if(signer.address.toLowerCase()!==configuredAgent.toLowerCase())throw Error('Configured testnet agent address does not match its signing key.');
  const reader=new Contract(liveEscrow,['function jobs(bytes32) view returns(address buyer,address provider,address agent,uint128 unitPrice,uint32 maxUnits,uint32 accepted,uint64 expiresAt,bool exists)','function usdc() view returns(address)'],provider);
  const jobState=await reader.jobs(jobIdBytes32(job.id));
  if(!jobState.exists)return {status:'job-not-funded'};
  if(jobState.buyer.toLowerCase()===jobState.provider.toLowerCase()||jobState.buyer.toLowerCase()===jobState.agent.toLowerCase()||jobState.provider.toLowerCase()===jobState.agent.toLowerCase())throw Error('Buyer, provider, and agent must be distinct wallets for an independent settlement.');
  if(!configuredBuyer||jobState.buyer.toLowerCase()!==configuredBuyer.toLowerCase()||jobState.agent.toLowerCase()!==signer.address.toLowerCase()||jobState.provider.toLowerCase()!==job.providerWallet.toLowerCase()||jobState.unitPrice!==BigInt(job.unitPriceAtomic)||jobState.maxUnits!==BigInt(job.maxUnits))throw Error('Funded escrow terms do not match this configured buyer, provider, agent, price, or cap.');
  if((await reader.usdc()).toLowerCase()!==(process.env.ARC_USDC_ADDRESS||ARC_TESTNET_USDC).toLowerCase())throw Error('Escrow is not configured for Arc Testnet USDC.');
  const latest=await provider.getBlock('latest');
  if(!latest||jobState.expiresAt<=BigInt(latest.timestamp))return {status:'job-expired'};
  if(Number(jobState.accepted)>=job.maxUnits)return {status:'job-cap-reached'};
  const idHash=jobIdBytes32(job.id),resultHash=resultIdBytes32(row.id),proof=evidenceHash(job.id,row,evaluation,agentReview);
  const signerContract=new Contract(liveEscrow,['function resolve(bytes32,bytes32,bool,bytes32)'],signer);
  const request=await signerContract.resolve.populateTransaction(idHash,resultHash,true,proof);
  request.nonce=await provider.getTransactionCount(signer.address,'pending');
  const populated=await signer.populateTransaction(request),signed=await signer.signTransaction(populated),preparedHash=keccak256(signed);
  await onBroadcast?.(preparedHash);
  const tx=await provider.broadcastTransaction(signed);
  if(tx.hash.toLowerCase()!==preparedHash.toLowerCase())throw Error('Broadcast transaction hash differs from the persisted signed transaction hash.');
  let receipt;
  try{receipt=await tx.wait()}catch{return {status:'pending-verification',txHash:tx.hash,message:'Agent transaction was submitted, but its confirmation is not yet known. Check this hash before taking further action.'}}
  if(!receipt||receipt.status!==1)return {status:'failed-onchain',txHash:tx.hash,message:'Agent transaction failed. Check the chain record before taking further action.'};
  return {status:'confirmed',proof:await verifyArcResolution(receipt.hash,row.id,'accept',row,evaluation,agentReview)};
}
function queueAcceptedSettlement(row,evaluation,agentReview,onBroadcast){
  const next=settlementQueue.then(()=>settleAcceptedResult(row,evaluation,agentReview,onBroadcast));
  settlementQueue=next.catch(()=>{});return next;
}
async function settleEligibleRow(row,evaluation,agentReview){
  let settlement;
  if(!liveEscrow||!agentReady){row.settlement={status:'testnet-setup-required'};await persistState();return {status:'testnet-setup-required'}}
  const unresolved=rows.find(r=>r.id!==row.id&&!decisions.has(r.id)&&['submitting','pending-verification','needs-attention','failed-onchain'].includes(r.settlement?.status));
  if(unresolved){row.settlement={status:'blocked-by-uncertain-transaction',message:`Waiting for transaction reconciliation on result ${unresolved.id}; no new payment was sent.`};await persistState();return row.settlement}
  row.settlement={status:'submitting'};await persistState();
  let broadcastHash;
  try{settlement=await queueAcceptedSettlement(row,evaluation,agentReview,async txHash=>{broadcastHash=txHash;row.settlement={status:'pending-verification',txHash};await persistState()})}catch{settlement=broadcastHash?{status:'pending-verification',txHash:broadcastHash,message:'Transaction was broadcast; verify this hash before taking further action.'}:{status:'needs-attention',message:'Testnet settlement could not be completed. Check local server logs; no automatic retry was made.'}}
  row.settlement={status:settlement.status,...(settlement.txHash?{txHash:settlement.txHash}:{}),...(settlement.message?{message:settlement.message}:{})};
  if(settlement.status==='confirmed'){
    const proof=settlement.proof,d={id:row.id,outcome:'accepted',reason:row.version===2?'Independent evidence supported the buyer-agent decision and the capped escrow paid the fixed unit price.':'Automated policy accepted the result and the capped escrow paid the fixed unit price.',decidedAt:new Date().toISOString(),evaluation,agentReview,payment:{status:'ARC TESTNET · PAYMENT CONFIRMED',amount:job.unitPrice,recipient:job.providerWallet,txHash:proof.txHash,blockNumber:proof.blockNumber,explorerUrl:proof.explorerUrl,evidenceHash:proof.evidenceHash}};
    job.acceptedCount=proof.acceptedUnits;d.receiptPayload={jobId:job.id,resultId:row.id,outcome:d.outcome,reason:d.reason,decidedAt:d.decidedAt,payment:d.payment,evaluation,agentReview,...(row.version===2?{submittedResult:{company:row.company,domain:row.domain,evidenceHint:row.evidenceHint||null},independentEvidence:row.independentEvidence||null,x402EvidencePurchase:row.evidencePurchase||null}:{} )};d.receiptHash=digest(d.receiptPayload);decisions.set(row.id,d);receipts.unshift(d);
  }
  await persistState();return settlement;
}
async function reconcileRow(row){
  const txHash=row.settlement?.txHash;
  if(!txHash){row.settlement={status:'needs-attention',message:'No transaction hash was saved; automatic retry is disabled.'};await persistState();return {resultId:row.id,...row.settlement}}
  const provider=new JsonRpcProvider(requireArcTestnetRpc(process.env)),network=await provider.getNetwork();
  if(network.chainId!==ARC_TESTNET_CHAIN_ID)throw Error('Reconciliation RPC is not Arc Testnet.');
  const receipt=await provider.getTransactionReceipt(txHash);
  if(!receipt)return {resultId:row.id,status:'pending-verification',txHash};
  if(receipt.status!==1){row.settlement={status:'failed-onchain',txHash,message:'The transaction failed on chain; no automatic retry was made.'};await persistState();return {resultId:row.id,...row.settlement}}
  const evaluation=evaluate(row),agentReview=agentReviews.get(row.id);
  if(!evaluation.eligible||!agentReview)throw Error('Saved result or policy record is missing; cannot verify this transaction.');
  const proof=await verifyArcResolution(receipt.hash,row.id,'accept',row,evaluation,agentReview);
  row.settlement={status:'confirmed',txHash:proof.txHash};
  const d={id:row.id,outcome:'accepted',reason:row.version===2?'Independent evidence supported the buyer-agent decision and the capped escrow paid the fixed unit price.':'Automated policy accepted the result and the capped escrow paid the fixed unit price.',decidedAt:new Date().toISOString(),evaluation,agentReview,payment:{status:'ARC TESTNET · PAYMENT CONFIRMED',amount:job.unitPrice,recipient:job.providerWallet,txHash:proof.txHash,blockNumber:proof.blockNumber,explorerUrl:proof.explorerUrl,evidenceHash:proof.evidenceHash}};
  job.acceptedCount=proof.acceptedUnits;d.receiptPayload={jobId:job.id,resultId:row.id,outcome:d.outcome,reason:d.reason,decidedAt:d.decidedAt,payment:d.payment,evaluation,agentReview,...(row.version===2?{submittedResult:{company:row.company,domain:row.domain,evidenceHint:row.evidenceHint||null},independentEvidence:row.independentEvidence||null,x402EvidencePurchase:row.evidencePurchase||null}:{} )};d.receiptHash=digest(d.receiptPayload);decisions.set(row.id,d);receipts.unshift(d);await persistState();
  return {resultId:row.id,status:'confirmed',txHash:proof.txHash,blockNumber:proof.blockNumber};
}
function evaluate(r) {
  if(r.version===2)return hardChecks(r,rows,job);
  const checks = [
    {label:'Category matches B2B SaaS',pass:r.category.toLowerCase().includes(job.criteria.categoryIncludes.toLowerCase())},
    {label:`Company team size is at least ${job.criteria.minEmployees}`,pass:Number.isInteger(Number(r.employeeCountAtLeast)) && r.employeeCountAtLeast>=job.criteria.minEmployees},
    {label:'HTTPS evidence URL matches the company domain',pass:(()=>{try{const domain=new URL('https://'+r.domain).hostname.toLowerCase(),url=new URL(r.evidenceUrl);return url.protocol==='https:'&&(url.hostname.toLowerCase()===domain||url.hostname.toLowerCase().endsWith('.'+domain))}catch{return false}})()},
    {label:'Company domain is unique',pass:rows.filter(x=>x.domain===r.domain).length===1}
  ]; return {eligible:checks.every(x=>x.pass),checks,evaluator:'Deterministic demo rules v1'};
}
for(const r of rows){
  if(agentReviews.has(r.id)||decisions.has(r.id))continue;
  if(r.version===2)continue;
  const evaluation=evaluate(r),eligible=evaluation.eligible;
  agentReviews.set(r.id,{agent:'proofpay-rule-policy-v1',recommendation:eligible?'accept':'reject',rationale:eligible?'All required job checks passed. The authorized testnet agent may pay this fixed price from the buyer-funded cap.':'One or more required job checks failed. The policy agent will not pay this result.',evaluatedAt:new Date().toISOString(),evaluation});
}
const respond=(res,status,data)=>{
  if(status===204){res.writeHead(204);return res.end();}
  res.writeHead(status,{'content-type':'application/json; charset=utf-8'});
  return res.end(JSON.stringify(data));
};
function recordUnpaid(row,evaluation,review,outcome,reason){
  const d={id:row.id,outcome,reason,decidedAt:new Date().toISOString(),evaluation,agentReview:review,payment:{status:outcome==='rejected'?'REJECTED · NO PAYMENT':'HUMAN REVIEW REQUIRED · NO PAYMENT',amount:'0.00',recipient:null,txHash:null}};
  d.receiptPayload={jobId:job.id,resultId:row.id,outcome,reason,decidedAt:d.decidedAt,submittedResult:{company:row.company,domain:row.domain,evidenceHint:row.evidenceHint||null},evaluation,agentReview:review,independentEvidence:row.independentEvidence||null,x402EvidencePurchase:row.evidencePurchase||null,payment:d.payment};
  d.receiptHash=digest(d.receiptPayload);decisions.set(row.id,d);receipts.unshift(d);return d;
}
async function agenticEscrowPreflight(){
  if(apiMode!=='arc-testnet')return 'Arc Testnet settlement is not ready.';
  const provider=new JsonRpcProvider(requireArcTestnetRpc(process.env));
  if((await provider.getNetwork()).chainId!==ARC_TESTNET_CHAIN_ID)return 'Settlement RPC is not Arc Testnet.';
  const escrow=new Contract(liveEscrow,['function jobs(bytes32) view returns(address buyer,address provider,address agent,uint128 unitPrice,uint32 maxUnits,uint32 accepted,uint64 expiresAt,bool exists)'],provider);
  const funded=await escrow.jobs(jobIdBytes32(job.id));
  if(!funded.exists)return 'Job has not been funded.';
  if(!configuredBuyer||funded.buyer.toLowerCase()!==configuredBuyer.toLowerCase()||funded.provider.toLowerCase()!==job.providerWallet.toLowerCase()||funded.agent.toLowerCase()!==configuredAgent.toLowerCase()||funded.unitPrice!==BigInt(job.unitPriceAtomic)||funded.maxUnits!==BigInt(job.maxUnits))return 'Funded job terms do not match the configured buyer, provider, agent, unit price, or cap.';
  if(funded.accepted>=funded.maxUnits)return 'Job cap is reached.';
  const latest=await provider.getBlock('latest');
  if(!latest)return 'Latest Arc Testnet block time could not be read.';
  if(funded.expiresAt<=BigInt(latest.timestamp))return 'Job has expired.';
  return null;
}
async function processAgenticResult(row){
  const evaluation=evaluate(row);
  if(!evaluation.eligible){
    const review={agent:'proofpay-hard-gates-v2',recommendation:'REJECT',confidence:1,evidence:[],reason:'A required deterministic check failed.',evaluatedAt:new Date().toISOString()};agentReviews.set(row.id,review);
    row.settlement={status:'policy-rejected'};const decision=recordUnpaid(row,evaluation,review,'rejected',review.reason);await persistState();return {status:201,decision};
  }
  let blocker;
  try{blocker=await agenticEscrowPreflight()}catch{blocker='Arc Testnet job status could not be verified.'}
  if(blocker){
    const review={agent:'proofpay-system-fail-closed',recommendation:'ESCALATE',confidence:0,evidence:[],reason:blocker,evaluatedAt:new Date().toISOString()};agentReviews.set(row.id,review);
    row.settlement={status:'human-review-required'};const decision=recordUnpaid(row,evaluation,review,'escalated',blocker);await persistState();return {status:202,decision};
  }
  const reserved=rows.reduce((sum,r)=>sum+(r.evidencePurchase?.amountAtomic||0),0);
  if(reserved+EXA_SEARCH_COST_ATOMIC>EVIDENCE_BUDGET_ATOMIC){
    const review={agent:'proofpay-system-fail-closed',recommendation:'ESCALATE',confidence:0,evidence:[],reason:'The approved $0.10 evidence budget is exhausted.',evaluatedAt:new Date().toISOString()};agentReviews.set(row.id,review);
    row.settlement={status:'human-review-required'};const decision=recordUnpaid(row,evaluation,review,'escalated',review.reason);await persistState();return {status:202,decision};
  }
  row.evidencePurchase={status:'attempted',service:'Exa search via Circle Gateway',amountAtomic:EXA_SEARCH_COST_ATOMIC,attemptedAt:new Date().toISOString()};await persistState();
  let evidence;
  try{evidence=await buyExaEvidence(row,job.criteria)}catch{
    row.evidencePurchase.status='uncertain';row.evidencePurchase.message='Evidence purchase could not be verified. Do not retry automatically.';
    const review={agent:'proofpay-system-fail-closed',recommendation:'ESCALATE',confidence:0,evidence:[],reason:'Independent evidence purchase did not complete verifiably. Do not retry automatically.',evaluatedAt:new Date().toISOString()};agentReviews.set(row.id,review);
    row.settlement={status:'human-review-required'};const decision=recordUnpaid(row,evaluation,review,'escalated',review.reason);await persistState();return {status:202,decision};
  }
  row.independentEvidence=evidence;row.evidencePurchase={...row.evidencePurchase,status:'confirmed',payment:evidence.x402};await persistState();
  const firstParty=evidence.sources.some(source=>{try{const host=new URL(source.url).hostname.toLowerCase();return host===row.domain||host.endsWith('.'+row.domain)}catch{return false}});
  if(!firstParty){
    const review={agent:'proofpay-evidence-gate-v2',recommendation:'ESCALATE',confidence:0,evidence:[],reason:'The paid search returned no first-party source for this domain.',evaluatedAt:new Date().toISOString()};agentReviews.set(row.id,review);
    row.settlement={status:'human-review-required'};const decision=recordUnpaid(row,evaluation,review,'escalated',review.reason);await persistState();return {status:202,decision};
  }
  let judgment;
  try{judgment=await judgeWithGroq(job,row,evaluation,evidence)}catch{
    const review={agent:'proofpay-system-fail-closed',recommendation:'ESCALATE',confidence:0,evidence:[],reason:'Groq judgment did not complete verifiably. No payment was made.',evaluatedAt:new Date().toISOString()};agentReviews.set(row.id,review);
    row.settlement={status:'human-review-required'};const decision=recordUnpaid(row,evaluation,review,'escalated',review.reason);await persistState();return {status:202,decision};
  }
  const review={agent:'proofpay-groq-v1',recommendation:judgment.decision,confidence:judgment.confidence,evidence:judgment.evidence,reason:judgment.reason,model:judgment.model,evaluatedAt:judgment.evaluatedAt};agentReviews.set(row.id,review);await persistState();
  if(judgment.decision!=='ACCEPT'){
    const outcome=judgment.decision==='REJECT'?'rejected':'escalated';row.settlement={status:outcome==='rejected'?'policy-rejected':'human-review-required'};
    const decision=recordUnpaid(row,evaluation,review,outcome,judgment.reason);await persistState();return {status:outcome==='rejected'?201:202,decision};
  }
  const settlement=await settleEligibleRow(row,evaluation,review);
  return {status:settlement.status==='confirmed'?201:202,decision:decisions.get(row.id)||null,settlement:row.settlement};
}
function queueAgenticResult(row){const next=agenticQueue.then(()=>processAgenticResult(row));agenticQueue=next.catch(()=>{});return next}
let interruptedAgentic=false;
for(const row of rows){
  if(row.version!==2||decisions.has(row.id))continue;
  if(agentReviews.get(row.id)?.recommendation==='ACCEPT'&&!row.settlement){row.settlement={status:'testnet-setup-required',message:'Accepted decision restored; settlement requires an explicit pending-settlement call.'};interruptedAgentic=true;continue}
  if(agentReviews.has(row.id))continue;
  if(row.evidencePurchase?.status==='attempted')row.evidencePurchase.status='uncertain';
  const evaluation=evaluate(row),review={agent:'proofpay-system-fail-closed',recommendation:'ESCALATE',confidence:0,evidence:[],reason:'Evaluation was interrupted; evidence purchase or model state may be uncertain. No automatic retry.',evaluatedAt:new Date().toISOString()};
  agentReviews.set(row.id,review);row.settlement={status:'human-review-required'};recordUnpaid(row,evaluation,review,'escalated',review.reason);interruptedAgentic=true;
}
if(interruptedAgentic)await persistState();
const server=createServer(async(req,res)=>{
  try {
    const p=new URL(req.url||'/', 'http://127.0.0.1').pathname;
    if(req.method==='OPTIONS')return respond(res,204);
    if(p.startsWith(`/api/v1/jobs/${OPPORTUNITY_RUN_ID}`)){
      const route=await handleOpportunityRoute(req.method,p,req.method==='POST'?await readJsonBody(req):null,createOpportunityService());
      if(route)return respond(res,route.status,route.body);
    }
    if(p==='/api/v1/jobs'&&req.method==='GET'){
      let opportunity=null;
      try{opportunity=await createOpportunityService().getJob()}catch(error){if(error.code!=='ENOENT')throw error}
      return respond(res,200,{data:[...(opportunity?[opportunity]:[]),job],mode:apiMode,readinessMessage});
    }
    if(p===`${jobPath}/results`&&req.method==='GET')return respond(res,200,{data:rows.map(r=>({...r,evaluation:evaluate(r),agentReview:agentReviews.get(r.id)||null,decision:decisions.get(r.id)||null})),mode:apiMode,readinessMessage});
    if(p===`${jobPath}/agent-results`&&req.method==='POST'){
      if(process.env.PROOFPAY_PAID_EVIDENCE_ENABLED!=='1')return respond(res,503,{error:'Agentic submissions are parked until a real operator defines acceptance criteria and paid evidence is justified.'});
      const x=await readJsonBody(req);
      if(typeof x.company!=='string'||!x.company.trim()||x.company.trim().length>100||typeof x.domain!=='string'||!x.domain.trim()||x.domain.trim().length>253)return respond(res,400,{error:'company (up to 100 characters) and domain (up to 253 characters) are required'});
      const company=x.company.trim(),domain=x.domain.trim().toLowerCase().replace(/^https?:\/\//,'').replace(/\/$/,'');
      if(!verifyProviderSubmission(job,x,company,domain))return respond(res,403,{error:'A signature from the configured provider wallet is required for this job and result.'});
      if(hasCompanyDomain(rows,domain))return respond(res,409,{error:'This company domain was already submitted; no payment was sent.'});
      if(!process.env.GROQ_API_KEY||!process.env.CIRCLE_AGENT_WALLET_ADDRESS)return respond(res,503,{error:'Groq and Circle Agent Wallet must be configured before accepting a payable result.'});
       try{await assertCircleSession()}catch{return respond(res,503,{error:'Circle Agent Wallet is not ready in this server environment.'})}
      const row={version:2,id:randomUUID(),company,domain,evidenceHint:typeof x.evidenceHint==='string'?x.evidenceHint.trim().slice(0,500):'',providerAddress:x.providerAddress,providerVerified:true,nonce:x.nonce,submittedAt:new Date().toISOString()};
       // Check and reserve synchronously after the awaited wallet check.
      if(!reserveUniqueCompanyDomain(rows,row))return respond(res,409,{error:'This company domain was already submitted; no payment was sent.'});
      await persistState();
      const result=await queueAgenticResult(row);
      return respond(res,result.status,{data:{...row,evaluation:evaluate(row),agentReview:agentReviews.get(row.id),decision:result.decision||null,settlement:row.settlement||null},mode:apiMode});
    }
    if(p===`${jobPath}/results`&&req.method==='POST'){
      if(process.env.PROOFPAY_LEGACY_SUBMISSIONS_ENABLED!=='1')return respond(res,410,{error:'Legacy claim-based submissions are closed. Use the signed agent-results path for independent evidence and AI judgment.'});
      const x=await readJsonBody(req); if(![x.company,x.domain,x.category,x.evidenceUrl].every(v=>typeof v==='string'&&v.trim())||!Number.isInteger(Number(x.employeeCountAtLeast))||Number(x.employeeCountAtLeast)<1)return respond(res,400,{error:'company, domain, category, a positive integer employeeCountAtLeast, and evidenceUrl are required'});
      const company=String(x.company).trim().slice(0,100),category=String(x.category).trim().slice(0,100),domain=String(x.domain).trim().toLowerCase().replace(/^https?:\/\//,'').replace(/\/$/,'');
      let evidence;
      try{const normalized=new URL('https://'+domain);if(normalized.hostname!==domain||!domain.includes('.'))throw Error();evidence=new URL(String(x.evidenceUrl).trim());if(evidence.protocol!=='https:'||evidence.username||evidence.password)throw Error()}catch{return respond(res,400,{error:'Use a plain company domain and an HTTPS evidence URL without credentials.'})}
      if(hasCompanyDomain(rows,domain))return respond(res,409,{error:'A result for this company domain already exists'});
      const r={id:randomUUID(),company,domain,category,employeeCountAtLeast:Number(x.employeeCountAtLeast),evidenceUrl:evidence.href.slice(0,500),submittedAt:new Date().toISOString()};
      if(!reserveUniqueCompanyDomain(rows,r))return respond(res,409,{error:'A result for this company domain already exists'});
      // Run the buyer policy automatically as part of ingestion. This is an
      // explicit deterministic policy evaluator, not an LLM or a human decision.
      const evaluation=evaluate(r),eligible=evaluation.eligible;
      const review={agent:'proofpay-rule-policy-v1',recommendation:eligible?'accept':'reject',rationale:eligible?'All required job checks passed. The authorized testnet agent may pay this fixed unit price from the buyer-funded cap.':'One or more required job checks failed. The policy agent will not pay this result.',evaluatedAt:new Date().toISOString(),evaluation};
      agentReviews.set(r.id,review);
      await persistState();
      if(!eligible){
        r.settlement={status:'policy-rejected'};
        const d={id:r.id,outcome:'rejected',reason:'Automated policy rejected the result; no payment was made.',decidedAt:new Date().toISOString(),evaluation,agentReview:review,payment:{status:'POLICY REJECTED · NO PAYMENT',amount:'0.00',recipient:null,txHash:null}};
        d.receiptPayload={jobId:job.id,resultId:r.id,outcome:d.outcome,reason:d.reason,decidedAt:d.decidedAt,payment:d.payment,evaluation,agentReview:review};d.receiptHash=digest(d.receiptPayload);decisions.set(r.id,d);receipts.unshift(d);await persistState();
        return respond(res,201,{data:{...r,evaluation,agentReview:review,decision:d},mode:apiMode});
      }
      const settlement=await settleEligibleRow(r,evaluation,review);
      if(settlement.status==='confirmed'){
        const d=decisions.get(r.id);
        return respond(res,201,{data:{...r,evaluation,agentReview:review,decision:d,settlement:{status:'confirmed'}},mode:'arc-testnet'});
      }
      return respond(res,202,{data:{...r,evaluation,agentReview:review,settlement:r.settlement},mode:apiMode});
    }
    if(p===`${jobPath}/settle-pending`&&req.method==='POST'){
      if(apiMode!=='arc-testnet')return respond(res,503,{error:'Testnet agent configuration is incomplete.'});
      const pending=rows.filter(r=>!decisions.has(r.id)&&evaluate(r).eligible&&(r.version!==2||agentReviews.get(r.id)?.recommendation==='ACCEPT')&&['testnet-setup-required','job-not-funded','blocked-by-uncertain-transaction'].includes(r.settlement?.status));
      const outcomes=[];
      for(const r of pending){const result=await settleEligibleRow(r,evaluate(r),agentReviews.get(r.id));outcomes.push({resultId:r.id,...r.settlement});if(result.status==='pending-verification'||result.status==='failed-onchain'||result.status==='needs-attention')break}
      return respond(res,200,{data:outcomes,mode:apiMode});
    }
    if(p===`${jobPath}/reconcile-pending`&&req.method==='POST'){
      const pending=rows.filter(r=>!decisions.has(r.id)&&(['pending-verification','submitting'].includes(r.settlement?.status)||(r.settlement?.status==='needs-attention'&&r.settlement?.txHash)));
      const outcomes=[];
      for(const row of pending){try{outcomes.push(await reconcileRow(row))}catch{row.settlement={status:'needs-attention',...(row.settlement?.txHash?{txHash:row.settlement.txHash}:{}),message:'Receipt reconciliation could not be verified. Check local server configuration and chain status.'};await persistState();outcomes.push({resultId:row.id,...row.settlement})}}
      return respond(res,200,{data:outcomes,mode:apiMode});
    }
    const resultAction=p.startsWith(`${jobPath}/results/`)?p.slice(`${jobPath}/results/`.length).split('/'):[];
    if(resultAction.length===2&&resultAction[1]==='recommendation'&&req.method==='POST'){
      return respond(res,410,{error:'The job policy evaluator runs at submission; external recommendations cannot alter settlement decisions.'});
    }
    if(resultAction.length===2&&['accept','reject'].includes(resultAction[1])&&req.method==='POST'){
      return respond(res,410,{error:'Per-result decisions are automatic after the buyer funds the capped escrow. Manual decision transactions are disabled.'});
    }
    if(p==='/api/v1/receipts'&&req.method==='GET')return respond(res,200,{data:receipts,mode:apiMode});
    if(p==='/api/v1/openapi'&&req.method==='GET'){
      return respond(res,200,buildOpenApi({jobId:job.id,opportunityRunId:OPPORTUNITY_RUN_ID,legacySubmissionsEnabled:process.env.PROOFPAY_LEGACY_SUBMISSIONS_ENABLED==='1',paidEvidenceEnabled:process.env.PROOFPAY_PAID_EVIDENCE_ENABLED==='1'}));
    }
    if(!['GET','HEAD'].includes(req.method))return respond(res,405,{error:'Static assets support GET and HEAD only.'});
    const file=resolve('dist',p==='/'?'index.html':'.'+p);
    if(file!==resolve('dist')&&!file.startsWith(resolve('dist')+sep))return respond(res,403,{error:'Forbidden'});
    try{const body=await readFile(file);res.writeHead(200,{'content-type':contentTypeForPath(file),'content-length':body.length});return res.end(req.method==='HEAD'?undefined:body)}catch{return respond(res,404,{error:'Build UI first with npm run build'})}
    return respond(res,404,{error:'Route not found'});
  }catch(e){
    const status=Number.isInteger(e.statusCode)&&e.statusCode>=400&&e.statusCode<500?e.statusCode:500;
    return respond(res,status,{error:status<500?e.message:'Internal server error.'});
  }
});
server.requestTimeout=30_000;
server.headersTimeout=15_000;
server.keepAliveTimeout=5_000;
server.listen(port,'127.0.0.1',()=>console.log(`TaskLatch API (${apiMode}) at http://127.0.0.1:${port}`));
