import { createContext, useContext } from 'react';
import { friendsPassGrantsUnlimited, grantFriendsPass } from '../utils/friendsPass';

export const SubscriptionContext = createContext(null);

const webFallback = {
  isPro: false,
  accessKind: null,
  offerings: null,
  isLoading: false,
  purchasePackage: async () => ({
    status: 'unavailable',
    message: 'Subscriptions are purchased in the RootMap iOS app.',
    isPro: friendsPassGrantsUnlimited()
  }),
  restorePurchases: async () => ({
    status: 'none',
    message: 'No previous purchases found.',
    isPro: friendsPassGrantsUnlimited()
  }),
  redeemOfferCode: async () => ({
    status: 'unavailable',
    message: 'Offer codes are redeemed in the RootMap iOS app.',
    isPro: friendsPassGrantsUnlimited()
  }),
  redeemFriendsPass: async (code) => {
    const result = grantFriendsPass(code);
    if (!result.ok) {
      return {
        status: 'error',
        message: result.message,
        isPro: friendsPassGrantsUnlimited()
      };
    }
    return {
      status: 'redeemed',
      message: 'Friends Pass is active for this season. Unlimited leagues are unlocked, and nothing was charged.',
      isPro: true,
      access: 'friends'
    };
  }
};

export function useSubscription() {
  return useContext(SubscriptionContext) || webFallback;
}
