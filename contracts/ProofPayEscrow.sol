// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
interface IERC20Minimal { function transfer(address,uint256) external returns(bool); function transferFrom(address,address,uint256) external returns(bool); }
/// @notice Fixed recipient and fixed unit-price escrow for policy-accepted outputs.
/// @dev Evaluation remains off-chain; the configured agent resolves outputs and this contract enforces funding, cap, replay, and settlement.
contract ProofPayEscrow {
 IERC20Minimal public immutable usdc;
 struct Job { address buyer; address provider; address agent; uint128 unitPrice; uint32 maxUnits; uint32 accepted; uint64 expiresAt; bool exists; }
 mapping(bytes32=>Job) public jobs;
 mapping(bytes32=>bool) public resolved;
 event JobOpened(bytes32 indexed jobId,address indexed buyer,address indexed provider,uint256 unitPrice,uint32 maxUnits,uint64 expiresAt);
 event ResultResolved(bytes32 indexed jobId,bytes32 indexed resultId,bool accepted,bytes32 evidenceHash,uint256 amount);
 event Refund(bytes32 indexed jobId,address indexed buyer,uint256 amount);
 error Unauthorized(); error InvalidJob(); error InvalidTerms(); error DuplicateResult(); error CapReached(); error Expired(); error NotExpired(); error TransferFailed();
 constructor(address token){if(token==address(0))revert InvalidTerms();usdc=IERC20Minimal(token);}
 function openJob(bytes32 id,address provider,address agent,uint128 unitPrice,uint32 maxUnits,uint64 expiresAt) external {
  if(jobs[id].exists)revert InvalidJob();
  if(provider==address(0)||agent==address(0)||provider==msg.sender||provider==agent||agent==msg.sender||unitPrice==0||maxUnits==0||expiresAt<=block.timestamp)revert InvalidTerms();
  jobs[id]=Job(msg.sender,provider,agent,unitPrice,maxUnits,0,expiresAt,true);
  if(!usdc.transferFrom(msg.sender,address(this),uint256(unitPrice)*maxUnits))revert TransferFailed();
  emit JobOpened(id,msg.sender,provider,unitPrice,maxUnits,expiresAt);
 }
 function resolve(bytes32 id,bytes32 resultId,bool accepted,bytes32 evidenceHash) external {
  Job storage j=jobs[id]; if(!j.exists)revert InvalidJob(); if(msg.sender!=j.agent)revert Unauthorized();
  if(block.timestamp>=j.expiresAt)revert Expired(); bytes32 scopedResult=keccak256(abi.encode(id,resultId)); if(resolved[scopedResult])revert DuplicateResult();
  resolved[scopedResult]=true; uint256 amount;
  if(accepted){if(j.accepted>=j.maxUnits)revert CapReached();j.accepted++;amount=j.unitPrice;if(!usdc.transfer(j.provider,amount))revert TransferFailed();}
  emit ResultResolved(id,resultId,accepted,evidenceHash,amount);
 }
 function refundUnused(bytes32 id) external {
  Job storage j=jobs[id];if(!j.exists)revert InvalidJob();if(msg.sender!=j.buyer)revert Unauthorized();if(block.timestamp<j.expiresAt)revert NotExpired();
  uint256 amount=uint256(j.maxUnits-j.accepted)*j.unitPrice;j.maxUnits=j.accepted;
  if(amount>0&&!usdc.transfer(j.buyer,amount))revert TransferFailed();emit Refund(id,j.buyer,amount);
 }
}
