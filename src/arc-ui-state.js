export function arcPanelState(state) {
  if (state?.wrongNetwork) {
    return { message: 'Switch wallet to Arc Testnet · chain ID 5042002', canFund: false, canRefund: false };
  }
  if (!state?.connected) {
    return { message: 'Connect the buyer wallet to inspect the escrow.', canFund: false, canRefund: false };
  }

  const refundAvailable = Boolean(
    state.exists
    && state.isBuyer
    && state.chainTimestamp !== null
    && state.chainTimestamp !== undefined
    && state.chainTimestamp >= state.expiresAt
  );

  if (!state.tokenMatches) {
    return {
      message: 'Configured escrow uses a different token than Arc Testnet USDC. Funding and settlement are disabled.',
      canFund: false,
      canRefund: refundAvailable,
    };
  }
  if (state.exists && !state.funded) {
    return {
      message: 'An escrow already exists for this job, but its buyer, provider, agent, token, price, or cap differs from the configured job. No new funding or payout action is available.',
      canFund: false,
      canRefund: refundAvailable,
    };
  }
  if (state.funded) {
    return {
      message: `Cap escrowed · ${state.accepted} of ${state.maxUnits} results paid`,
      canFund: false,
      canRefund: refundAvailable,
    };
  }
  if (!state.authorizedBuyer) {
    return { message: 'This wallet is not the buyer configured for this job. Connect the configured buyer wallet to fund it.', canFund: false, canRefund: false };
  }
  return { message: 'Connected as the configured buyer on Arc Testnet · fund the fixed cap once', canFund: true, canRefund: false };
}
