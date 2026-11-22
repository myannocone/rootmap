import { registerPlugin } from '@capacitor/core';

/**
 * Native StoreKit offer-code sheet.
 * iOS 16+ presents AppStore.presentOfferCodeRedeemSheet.
 * Earlier iOS presents SKPaymentQueue offer-code redemption.
 */
export const OfferCodeRedemption = registerPlugin('OfferCodeRedemption');
