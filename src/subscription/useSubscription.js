import { createContext, useContext } from 'react';

export const SubscriptionContext = createContext(null);

const webFallback = {
  isPro: false,
  offerings: null,
  isLoading: false,
  purchasePackage: async () => ({
    status: 'unavailable',
    message: 'Subscriptions are purchased in the RootMap iOS app.',
    isPro: false
  }),
  restorePurchases: async () => ({
    status: 'none',
    message: 'No previous purchases found.',
    isPro: false
  })
};

export function useSubscription() {
  return useContext(SubscriptionContext) || webFallback;
}
