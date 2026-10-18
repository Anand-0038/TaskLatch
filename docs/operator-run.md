# Recorded operator run

This note documents the saved ProofPay/TaskLatch run. It is a personal self-use workflow and a pre-event technical baseline, not business traction.

## Task and rules

The operator asked for ten active AI/Web3 hackathons, grants, bounties, or builder programs worth considering. A result needed a verifiable benefit of at least ₹1 lakh, an open application deadline, eligibility for an India-based student or builder, an official source, meaningful builder relevance, and no duplicate or unsupported claims. Three candidates were submitted to the fixed workflow; the remaining shortlist was not evaluated or paid by ProofPay.

## Decisions

| Candidate | Decision | Recorded basis | Result payment |
|---|---|---|---:|
| [ZIROH Build Next 2026](https://www.ziroh.com/hackathon) | ACCEPT | The independently fetched 27 September snapshot showed a ₹7.5 lakh pool, an open 15 October deadline, India eligibility, and an AI challenge. | 0.10 test USDC |
| [ETHOnline 2026](https://ethglobal.com/events/ethonline2026) | REJECT | The official event dates ended on 16 September 2026. | 0 |
| [Algorand Global x402 Challenge](https://algorand.co/global-x402-challenge) | REJECT | The [official rules](https://algorand.co/hubfs/Hackathon%20Terms%20and%20conditions/x402%20competition%20Official%20Rules_Sep3rd26_.pdf) closed new-entrant registration on 1 September; the later submission deadline applied to registered entrants. | 0 |

Algorand was first escalated on incomplete information. After the official rules clarified the new-entrant cutoff, the saved result was corrected to REJECT. No ambiguous result was manufactured for the demo.

## Settlement evidence

- Network: Arc Testnet, chain ID `5042002`.
- Job: `proofpay-opportunities-20260927-01`, ten units at `0.10` test USDC each, `1.00` test USDC cap.
- Accepted-result transaction: [0xc43b20352f0c118efbaaa975bb10abe0b07b0ef8634f1bbe9d77ea4f49d24a7d](https://explorer.testnet.arc.io/tx/0xc43b20352f0c118efbaaa975bb10abe0b07b0ef8634f1bbe9d77ea4f49d24a7d).
- Decision receipt hash: `0xb27fef8cfcf88c3628e1ea0f41f265730419e9c8319fc17f7ef5532ec8fb0398`.
- A fresh-process read-only receipt check succeeded; the contract's duplicate guard prevented another payout.

## Timing and limits

The saved source retrievals and Groq decisions were timestamped 27 September 2026, 11:59 AM–12:09 PM IST. The supplied Luma event details list kickoff at 5:30 PM IST, so this evaluation is pre-event baseline and is not counted as Tameion-window usage. A later `verifiedAt` value records a local receipt check, not an on-chain block timestamp.

On 5 October, the organizer's ZIROH page was manually rechecked and listed 16 October rather than the saved snapshot's 15 October. That separate note did not change the saved decision, receipt, or payment; it is not a new evaluation.

The operator was using the output for personal research. No business was onboarded, no third-party task or acceptance criteria were supplied, and no external operator reviewed the results. The settlement used a locally held EOA. No Circle Agent Wallet, Gateway/x402 purchase, Paymaster, App Kit, CCTP, Developer-Controlled Wallet, or mainnet transaction is claimed.
