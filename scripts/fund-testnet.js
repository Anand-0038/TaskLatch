import { Contract, JsonRpcProvider, Wallet, getAddress, parseUnits, formatUnits } from 'ethers';
import { ARC_TESTNET_CHAIN_ID, ARC_TESTNET_USDC, ARC_EXPLORER, jobIdBytes32, requireArcTestnetRpc } from '../shared/evidence.js';

const chainId=ARC_TESTNET_CHAIN_ID;
const rpc=requireArcTestnetRpc(process.env);
const token=getAddress(process.env.ARC_USDC_ADDRESS||ARC_TESTNET_USDC);
const escrowAddress=getAddress(process.env.PROOFPAY_ESCROW_ADDRESS||'');
const providerAddress=getAddress(process.env.PROOFPAY_PROVIDER_ADDRESS||'');
const agentAddress=getAddress(process.env.PROOFPAY_AGENT_ADDRESS||'');
const secret=process.env.ARC_TESTNET_PRIVATE_KEY;
if(!secret)throw Error('Set ARC_TESTNET_PRIVATE_KEY to the buyer/deployer testnet wallet.');
const provider=new JsonRpcProvider(rpc),network=await provider.getNetwork();
if(network.chainId!==chainId)throw Error('Refusing funding: RPC is not Arc Testnet (chain ID 5042002).');
if((await provider.getCode(token))==='0x'||(await provider.getCode(escrowAddress))==='0x')throw Error('Configured USDC or escrow has no contract code on Arc Testnet.');
const buyer=new Wallet(secret,provider),jobLabel=process.env.PROOFPAY_JOB_ID||'job-demo-001',jobId=jobIdBytes32(jobLabel),unitPrice=parseUnits('0.02',6),maxUnits=5,cap=unitPrice*BigInt(maxUnits);
if(buyer.address.toLowerCase()===providerAddress.toLowerCase()||buyer.address.toLowerCase()===agentAddress.toLowerCase()||providerAddress.toLowerCase()===agentAddress.toLowerCase())throw Error('Buyer, provider, and agent must be three distinct wallets before funding. No transaction sent.');
const tokenContract=new Contract(token,['function balanceOf(address) view returns(uint256)','function allowance(address,address) view returns(uint256)','function approve(address,uint256) returns(bool)'],buyer);
const escrow=new Contract(escrowAddress,[
  'function usdc() view returns(address)',
  'function jobs(bytes32) view returns(address buyer,address provider,address agent,uint128 unitPrice,uint32 maxUnits,uint32 accepted,uint64 expiresAt,bool exists)',
  'function openJob(bytes32,address,address,uint128,uint32,uint64)',
],buyer);
if((await escrow.usdc()).toLowerCase()!==token.toLowerCase())throw Error('Escrow token differs from configured Arc Testnet USDC.');
const existing=await escrow.jobs(jobId);
if(existing.exists){
  const matches=existing.buyer.toLowerCase()===buyer.address.toLowerCase()&&existing.provider.toLowerCase()===providerAddress.toLowerCase()&&existing.agent.toLowerCase()===agentAddress.toLowerCase()&&existing.unitPrice===unitPrice&&existing.maxUnits===BigInt(maxUnits);
  if(!matches)throw Error('The job ID is already funded with different terms. No transaction sent.');
  console.log(`Job already funded; no duplicate transaction sent. Buyer ${buyer.address}; accepted ${existing.accepted}/${maxUnits}; expiry ${new Date(Number(existing.expiresAt)*1000).toISOString()}.`);
  process.exit(0);
}
const balance=await tokenContract.balanceOf(buyer.address);
if(balance<cap)throw Error(`Buyer test USDC balance ${formatUnits(balance,6)} is below the exact cap ${formatUnits(cap,6)}.`);
const gasBalance=await provider.getBalance(buyer.address);
if(gasBalance===0n)throw Error('Buyer wallet has no Arc Testnet gas token.');
console.log(`Arc Testnet verified. Buyer ${buyer.address}; cap ${formatUnits(cap,6)} test USDC; provider ${providerAddress}; agent ${agentAddress}.`);
if(await tokenContract.allowance(buyer.address,escrowAddress)<cap){
  const approval=await tokenContract.approve(escrowAddress,cap);
  console.log('Exact-cap approval submitted:',approval.hash);
  const approved=await approval.wait();
  if(!approved||approved.status!==1)throw Error('Exact-cap approval failed; job was not opened.');
  console.log('Exact-cap approval confirmed:',approved.hash);
}
const expiry=BigInt(Math.floor(Date.now()/1000)+14*24*60*60);
const open=await escrow.openJob(jobId,providerAddress,agentAddress,unitPrice,maxUnits,expiry);
console.log('Job funding submitted:',open.hash);
const receipt=await open.wait();
if(!receipt||receipt.status!==1)throw Error('Job funding failed on chain. Check the hash before retrying.');
const confirmed=await escrow.jobs(jobId);
if(!confirmed.exists||confirmed.buyer.toLowerCase()!==buyer.address.toLowerCase()||confirmed.provider.toLowerCase()!==providerAddress.toLowerCase()||confirmed.agent.toLowerCase()!==agentAddress.toLowerCase()||confirmed.unitPrice!==unitPrice||confirmed.maxUnits!==BigInt(maxUnits))throw Error('Funding receipt confirmed but stored job terms do not match expected values.');
console.log('Funded cap confirmed:',formatUnits(cap,6),'test USDC; 14-day expiry.');
console.log('Arc Testnet tx:',receipt.hash);
console.log('Explorer: '+ARC_EXPLORER+'/tx/'+receipt.hash);
