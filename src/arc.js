import { BrowserProvider, Contract, getAddress, parseUnits, ZeroAddress } from 'ethers';
import { jobIdBytes32, ARC_TESTNET_CHAIN_ID, ARC_TESTNET_USDC, ARC_EXPLORER } from '../shared/evidence.js';

const escrowAddress=import.meta.env.VITE_PROOFPAY_ESCROW_ADDRESS||'';
const tokenAddress=import.meta.env.VITE_ARC_USDC_ADDRESS||ARC_TESTNET_USDC;
const providerAddress=import.meta.env.VITE_PROVIDER_WALLET_ADDRESS||'';
const agentAddress=import.meta.env.VITE_PROOFPAY_AGENT_ADDRESS||'';
export const ARC_CONFIGURED=Boolean(escrowAddress&&providerAddress&&agentAddress);
const escrowAbi=[
 'function openJob(bytes32 jobId,address provider,address agent,uint128 unitPrice,uint32 maxUnits,uint64 expiresAt)',
 'function resolve(bytes32 jobId,bytes32 resultId,bool accepted,bytes32 evidenceHash)',
 'function refundUnused(bytes32 jobId)',
 'function usdc() view returns(address)',
 'function jobs(bytes32) view returns (address buyer,address provider,address agent,uint128 unitPrice,uint32 maxUnits,uint32 accepted,uint64 expiresAt,bool exists)'
];
const tokenAbi=['function approve(address spender,uint256 value) returns (bool)'];
let walletProvider, signer, address;

function configuredAddresses(){
 if(!ARC_CONFIGURED)throw Error('Set escrow, provider, and agent addresses in .env first.');
 const escrow=getAddress(escrowAddress);
 const token=getAddress(tokenAddress);
 const provider=getAddress(providerAddress);
 const agent=getAddress(agentAddress);
 if(escrow===ZeroAddress||token===ZeroAddress||provider===ZeroAddress||agent===ZeroAddress)throw Error('Escrow, USDC, provider, and agent addresses must be nonzero.');
 return {escrow,token,provider,agent};
}
async function requireEscrowCode(provider,escrow){if(await provider.getCode(escrow)==='0x')throw Error('Configured escrow address has no contract code on Arc Testnet.');}
async function requireTokenMatch(provider,escrow,token){
 const contract=new Contract(escrow,escrowAbi,provider);
 const actual=getAddress(await contract.usdc());
 if(actual.toLowerCase()!==token.toLowerCase())throw Error('Escrow token does not match the configured Arc Testnet USDC address.');
 if(await provider.getCode(token)==='0x')throw Error('Configured Arc Testnet USDC address has no contract code.');
 return contract;
}
async function ensureSigner(){
 if(!window.ethereum)throw Error('No injected wallet found. Open this app in a browser with a wallet.');
 walletProvider=new BrowserProvider(window.ethereum);
 const accounts=await window.ethereum.request({method:'eth_requestAccounts'});
 if(!accounts?.length)throw Error('Wallet connection was not approved.');
 address=getAddress(accounts[0]);signer=await walletProvider.getSigner();
 const network=await walletProvider.getNetwork();
 if(network.chainId!==ARC_TESTNET_CHAIN_ID)throw Error('Switch the wallet to Arc Testnet (chain ID 5042002). No other network is supported.');
 return address;
}
export async function connectArc(){await ensureSigner();return address;}
export async function arcJobState(job){
 if(!job?.id)throw Error('The configured fixture job is unavailable.');
 const {escrow,token,provider,agent}=configuredAddresses();
 if(!window.ethereum)return {connected:false,funded:false};
 walletProvider=new BrowserProvider(window.ethereum);
 const accounts=await window.ethereum.request({method:'eth_accounts'});
 if(!accounts?.length)return {connected:false,funded:false};
 address=getAddress(accounts[0]);
 const network=await walletProvider.getNetwork();
 if(network.chainId!==ARC_TESTNET_CHAIN_ID)return {connected:true,wrongNetwork:true,address,funded:false};
 await requireEscrowCode(walletProvider,escrow);
 const contract=new Contract(escrow,escrowAbi,walletProvider),actualToken=getAddress(await contract.usdc());
 const tokenMatches=actualToken.toLowerCase()===token.toLowerCase();
 const j=await contract.jobs(jobIdBytes32(job.id));
 const latest=await walletProvider.getBlock('latest');
 const roleConflict=Boolean(j.exists)&&(j.buyer.toLowerCase()===j.provider.toLowerCase()||j.buyer.toLowerCase()===j.agent.toLowerCase()||j.provider.toLowerCase()===j.agent.toLowerCase());
 const buyerMatches=Boolean(j.exists)&&j.buyer.toLowerCase()===address.toLowerCase();
 const rolesMatch=Boolean(j.exists)&&j.provider.toLowerCase()===provider.toLowerCase()&&j.agent.toLowerCase()===agent.toLowerCase();
 const termsMatch=Boolean(j.exists)&&j.unitPrice===parseUnits(job.unitPrice,6)&&j.maxUnits===BigInt(job.maxUnits);
 const authorizedBuyer=Boolean(job.buyerWallet)&&job.buyerWallet.toLowerCase()===address.toLowerCase();
 return {connected:true,address,exists:Boolean(j.exists),isBuyer:buyerMatches,authorizedBuyer,funded:Boolean(j.exists)&&buyerMatches&&authorizedBuyer&&rolesMatch&&termsMatch&&tokenMatches&&!roleConflict,roleConflict,rolesMatch,termsMatch,tokenMatches,accepted:Number(j.accepted),maxUnits:Number(j.maxUnits),expiresAt:Number(j.expiresAt),chainTimestamp:latest?.timestamp??null,provider,agent};
}
export async function fundArcJob(job){
 if(!job?.id||!job.unitPrice||!Number.isSafeInteger(Number(job.maxUnits))||Number(job.maxUnits)<1||Number(job.maxUnits)>0xffffffff)throw Error('A valid configured job with a positive cap is required before funding.');
 const account=await ensureSigner(),{escrow,token:configuredToken,provider,agent}=configuredAddresses();
 if(!job.buyerWallet||getAddress(job.buyerWallet).toLowerCase()!==account.toLowerCase())throw Error('Connect the configured buyer wallet before funding this job.');
 const price=parseUnits(job.unitPrice,6);
 if(price<=0n||price>=(1n<<128n))throw Error('Configured unit price is outside the escrow range.');
 if(account.toLowerCase()===provider.toLowerCase()||account.toLowerCase()===agent.toLowerCase()||provider.toLowerCase()===agent.toLowerCase())throw Error('Buyer, provider, and agent must be three distinct wallets before funding.');
 await requireEscrowCode(walletProvider,escrow);
 const readContract=await requireTokenMatch(walletProvider,escrow,configuredToken),contract=readContract.connect(signer),id=jobIdBytes32(job.id);
 const existing=await contract.jobs(id);
 if(existing.exists){
  if(existing.buyer.toLowerCase()!==account.toLowerCase()||existing.provider.toLowerCase()!==provider.toLowerCase()||existing.agent.toLowerCase()!==agent.toLowerCase()||existing.unitPrice!==parseUnits(job.unitPrice,6)||existing.maxUnits!==BigInt(job.maxUnits))throw Error('This job ID is already funded with different buyer, provider, agent, price, or cap terms.');
  return {funded:true};
 }
 const cap=parseUnits(job.unitPrice,6)*BigInt(job.maxUnits);
 const token=new Contract(configuredToken,tokenAbi,signer);
 const approval=await token.approve(escrow,cap),approved=await approval.wait();
 if(!approved||approved.status!==1)throw Error('USDC approval did not confirm on Arc Testnet; escrow was not opened.');
 if(await token.allowance(account,escrow)<cap)throw Error('Confirmed approval did not grant the exact escrow allowance; no job was opened.');
 const latest=await walletProvider.getBlock('latest');if(!latest)throw Error('Could not read the latest Arc Testnet block timestamp; escrow was not opened.');
 const expiry=BigInt(latest.timestamp+14*24*60*60);
 const tx=await contract.openJob(id,provider,agent,parseUnits(job.unitPrice,6),job.maxUnits,expiry);
 const receipt=await tx.wait();
 if(!receipt||receipt.status!==1)throw Error('Escrow funding transaction did not confirm.');
 const confirmed=await contract.jobs(id);
 if(!confirmed.exists||confirmed.buyer.toLowerCase()!==account.toLowerCase()||confirmed.provider.toLowerCase()!==provider.toLowerCase()||confirmed.agent.toLowerCase()!==agent.toLowerCase()||confirmed.unitPrice!==parseUnits(job.unitPrice,6)||confirmed.maxUnits!==BigInt(job.maxUnits))throw Error('Funding transaction confirmed, but the on-chain job terms do not match the requested job.');
 return {funded:true,txHash:receipt.hash,blockNumber:Number(receipt.blockNumber)};
}
export async function refundArcJob(jobId){const account=await ensureSigner();const {escrow}=configuredAddresses();await requireEscrowCode(walletProvider,escrow);const contract=new Contract(escrow,escrowAbi,signer),state=await contract.jobs(jobIdBytes32(jobId));if(!state.exists||state.buyer.toLowerCase()!==account.toLowerCase())throw Error('Only the buyer of an existing escrow may refund it.');const latest=await walletProvider.getBlock('latest');if(!latest||BigInt(latest.timestamp)<state.expiresAt)throw Error('Unused escrow funds can be refunded only after the on-chain expiry time.');const tx=await contract.refundUnused(jobIdBytes32(jobId));const receipt=await tx.wait();if(!receipt||receipt.status!==1)throw Error('Refund transaction did not confirm on Arc Testnet.');return {txHash:receipt.hash,blockNumber:Number(receipt.blockNumber)};}
export const arcExplorerTx=hash=>ARC_EXPLORER+'/tx/'+hash;
