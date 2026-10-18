import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import solc from 'solc';
import ganache from 'ganache';
import { AbiCoder, BrowserProvider, ContractFactory, keccak256, toUtf8Bytes } from 'ethers';

const mockSource = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
contract MockUSDC {
  mapping(address => uint256) public balanceOf;
  mapping(address => mapping(address => uint256)) public allowance;
  function mint(address to, uint256 amount) external { balanceOf[to] += amount; }
  function approve(address spender, uint256 amount) external returns (bool) { allowance[msg.sender][spender] = amount; return true; }
  function transfer(address to, uint256 amount) external returns (bool) { require(balanceOf[msg.sender] >= amount); balanceOf[msg.sender] -= amount; balanceOf[to] += amount; return true; }
  function transferFrom(address from, address to, uint256 amount) external returns (bool) { require(balanceOf[from] >= amount && allowance[from][msg.sender] >= amount); allowance[from][msg.sender] -= amount; balanceOf[from] -= amount; balanceOf[to] += amount; return true; }
}`;

const escrowSource = await readFile(new URL('../contracts/ProofPayEscrow.sol', import.meta.url), 'utf8');
const compiled = JSON.parse(solc.compile(JSON.stringify({
  language: 'Solidity',
  sources: { 'ProofPayEscrow.sol': { content: escrowSource }, 'MockUSDC.sol': { content: mockSource } },
  settings: { evmVersion: 'shanghai', outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } }
})));
const errors = (compiled.errors || []).filter((item) => item.severity === 'error');
assert.deepEqual(errors, [], errors.map((item) => item.formattedMessage).join('\n'));
const escrowArtifact = compiled.contracts['ProofPayEscrow.sol'].ProofPayEscrow;
const tokenArtifact = compiled.contracts['MockUSDC.sol'].MockUSDC;

const raw = ganache.provider({ logging: { quiet: true }, wallet: { deterministic: true, totalAccounts: 5 }, chain: { chainId: 1337, hardfork: 'shanghai' } });
const rpc = new BrowserProvider(raw);
const [buyer, provider, agent, stranger] = await Promise.all([0, 1, 2, 3].map((index) => rpc.getSigner(index)));
const token = await new ContractFactory(tokenArtifact.abi, `0x${tokenArtifact.evm.bytecode.object}`, buyer).deploy();
await token.waitForDeployment();
const escrow = await new ContractFactory(escrowArtifact.abi, `0x${escrowArtifact.evm.bytecode.object}`, buyer).deploy(await token.getAddress());
await escrow.waitForDeployment();
await (await token.mint(await buyer.getAddress(), 10_000_000n)).wait();
const buyerToken = token.connect(buyer);
const unitPrice = 20_000n;
const providerAddress = await provider.getAddress();
const agentAddress = await agent.getAddress();
const buyerAddress = await buyer.getAddress();
const now = async () => Number((await rpc.getBlock('latest')).timestamp);
const id = (name) => keccak256(toUtf8Bytes(name));
const openJob = async (name, payee = providerAddress, executor = agentAddress, maxUnits = 5, expiresAt) => {
  expiresAt ??= (await now()) + 3600;
  const cap = unitPrice * BigInt(maxUnits);
  await (await buyerToken.approve(await escrow.getAddress(), cap)).wait();
  await (await escrow.openJob(id(name), payee, executor, unitPrice, maxUnits, expiresAt)).wait();
};
const mustRevert = async (call, label) => {
  let reverted = false;
  try { await call; } catch { reverted = true; }
  assert.equal(reverted, true, `${label} should revert`);
};

// 1. Every business role must be a different address.
for (const [name, payee, executor] of [
  ['overlap-buyer-provider', buyerAddress, agentAddress],
  ['overlap-buyer-agent', providerAddress, buyerAddress],
  ['overlap-provider-agent', agentAddress, agentAddress]
]) {
  const existsBefore = (await escrow.jobs(id(name))).exists;
  await mustRevert(escrow.openJob(id(name), payee, executor, unitPrice, 1, await now() + 3600), name);
  assert.equal((await escrow.jobs(id(name))).exists, existsBefore, `${name} must not create a job`);
}
console.log('PASS distinct buyer/provider/agent roles');

// 2. Only the configured executor can resolve a result.
await openJob('unauthorized-executor');
await mustRevert(escrow.connect(stranger).resolve(id('unauthorized-executor'), id('result-1'), true, id('proof')), 'unauthorized executor');
assert.equal(await token.balanceOf(providerAddress), 0n);
console.log('PASS unauthorized executor rejected');

// 3. A valid accepted result transfers exactly one fixed-price unit.
await openJob('valid-payment');
const beforeValid = await token.balanceOf(providerAddress);
const paidReceipt = await (await escrow.connect(agent).resolve(id('valid-payment'), id('valid-result'), true, id('valid-proof'))).wait();
const afterValid = await token.balanceOf(providerAddress);
assert.equal(afterValid - beforeValid, unitPrice);
assert.equal((await escrow.jobs(id('valid-payment'))).accepted, 1n);
assert(paidReceipt.logs.length > 0, 'accepted resolution must emit an event');
console.log('PASS accepted unit pays the fixed amount');

// 4. The same result cannot settle twice.
await openJob('duplicate-payment');
await (await escrow.connect(agent).resolve(id('duplicate-payment'), id('same-result'), true, id('proof-1'))).wait();
const beforeDuplicate = await token.balanceOf(providerAddress);
await mustRevert(escrow.connect(agent).resolve(id('duplicate-payment'), id('same-result'), true, id('proof-2')), 'duplicate result');
assert.equal(await token.balanceOf(providerAddress), beforeDuplicate);
console.log('PASS duplicate result cannot cause a second payment');

// 5. A rejected result pays zero and cannot later be replayed as accepted.
await openJob('zero-payment');
const rejectedJobId = id('zero-payment'), rejectedResultId = id('rejected-result');
const rejectedScope = keccak256(AbiCoder.defaultAbiCoder().encode(['bytes32', 'bytes32'], [rejectedJobId, rejectedResultId]));
const beforeRejected = await token.balanceOf(providerAddress);
const rejectedReceipt = await (await escrow.connect(agent).resolve(rejectedJobId, rejectedResultId, false, id('rejection-proof'))).wait();
const rejectedEvent = rejectedReceipt.logs.map((log) => { try { return escrow.interface.parseLog(log); } catch { return null; } }).find((event) => event?.name === 'ResultResolved');
assert(rejectedEvent, 'rejected resolution must emit ResultResolved');
assert.equal(rejectedEvent.args.accepted, false);
assert.equal(rejectedEvent.args.amount, 0n);
assert.equal(await token.balanceOf(providerAddress), beforeRejected);
assert.equal((await escrow.jobs(rejectedJobId)).accepted, 0n);
assert.equal(await escrow.resolved(rejectedScope), true);
await mustRevert(escrow.connect(agent).resolve(rejectedJobId, rejectedResultId, true, id('later-acceptance')), 'rejected result replay');
assert.equal(await token.balanceOf(providerAddress), beforeRejected);
console.log('PASS rejected result pays zero and cannot later be upgraded to a payout');

// 6. An accepted count cannot exceed the funded unit cap.
await openJob('cap-payment', providerAddress, agentAddress, 1);
await (await escrow.connect(agent).resolve(id('cap-payment'), id('cap-result-1'), true, id('proof-1'))).wait();
const beforeCap = await token.balanceOf(providerAddress);
await mustRevert(escrow.connect(agent).resolve(id('cap-payment'), id('cap-result-2'), true, id('proof-2')), 'job cap');
assert.equal(await token.balanceOf(providerAddress), beforeCap);
assert.equal((await escrow.jobs(id('cap-payment'))).accepted, 1n);
console.log('PASS max-units cap cannot be exceeded');

// 7. Expired jobs cannot authorize a new payout.
await openJob('expired-payment', providerAddress, agentAddress, 1, await now() + 30);
await raw.request({ method: 'evm_increaseTime', params: [31] });
await raw.request({ method: 'evm_mine', params: [] });
await mustRevert(escrow.connect(agent).resolve(id('expired-payment'), id('expired-result'), true, id('proof')), 'expired job');
console.log('PASS expired job rejects new payouts');

await raw.disconnect();
console.log('All seven Arc escrow contract checks passed on an isolated local EVM.');
