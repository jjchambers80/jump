// Fee configuration for all-in pricing (FTC compliance)
// Pass-through model: listed tier price is base, fees added on top at checkout

export const FEE_CONFIG = {
  platformFeePercent: 0.05, // 5% service fee on base price
  stripeFeePercent: 0.029, // Stripe's 2.9%
  stripeFeeFixed: 0.3, // Stripe's $0.30 per transaction
  taxRate: 0, // Placeholder for future tax support
};
