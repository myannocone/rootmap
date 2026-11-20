import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Purchases } from '@revenuecat/purchases-capacitor';
import { loadIsPro, saveIsPro } from '../utils/proEntitlement';
import { SubscriptionContext } from './useSubscription';

const PRO_ENTITLEMENT_ID = 'rootmap_pro';

let configureTask = null;

function revenueCatApiKey() {
  return import.meta.env.VITE_REVENUECAT_APPLE_API_KEY || 'appl_rDNdjFEaZvTPYrIoGQCRGqOAvPc';
}

function isNativeIos() {
  try {
    return Capacitor.getPlatform() === 'ios';
  } catch {
    return false;
  }
}

function entitlementActive(customerInfo) {
  const active = customerInfo?.entitlements?.active;
  if (!active || typeof active !== 'object') return false;
  return Boolean(active[PRO_ENTITLEMENT_ID]);
}

function errorMessage(error) {
  if (!error) return '';
  if (typeof error === 'string') return error;
  return String(error.message || error.underlyingErrorMessage || '').trim();
}

function isPurchaseCancelled(error) {
  const code = String(error?.code ?? '');
  if (code === '1' || code === 'PURCHASE_CANCELLED_ERROR') return true;
  if (error?.userCancelled) return true;
  return /cancel/i.test(errorMessage(error));
}

function ensureIosPurchases() {
  if (!configureTask) {
    configureTask = Purchases.configure({ apiKey: revenueCatApiKey() }).catch((error) => {
      configureTask = null;
      throw error;
    });
  }
  return configureTask;
}

function unwrapOfferings(result) {
  if (!result || typeof result !== 'object') return null;
  if (result.current || result.all) return result;
  if (result.offerings && typeof result.offerings === 'object') return result.offerings;
  return null;
}

export function SubscriptionProvider({ children }) {
  const nativeIos = isNativeIos();
  const [isPro, setIsPro] = useState(() => nativeIos && loadIsPro());
  const [offerings, setOfferings] = useState(null);
  const [isLoading, setIsLoading] = useState(nativeIos);
  const isProRef = useRef(isPro);
  useEffect(() => {
    isProRef.current = isPro;
  }, [isPro]);

  const applyCustomerInfo = useCallback((customerInfo) => {
    const pro = entitlementActive(customerInfo);
    setIsPro(pro);
    saveIsPro(pro);
    return pro;
  }, []);

  useEffect(() => {
    if (!nativeIos) return undefined;

    const task = { cancelled: false, listenerId: null };
    (async () => {
      try {
        await ensureIosPurchases();
        if (task.cancelled) return;
        const listenerId = await Purchases.addCustomerInfoUpdateListener((customerInfo) => {
          if (!task.cancelled) applyCustomerInfo(customerInfo);
        });
        if (task.cancelled) {
          await Purchases.removeCustomerInfoUpdateListener({ listenerToRemove: listenerId }).catch(() => {});
          return;
        }
        task.listenerId = listenerId;
        const infoResult = await Purchases.getCustomerInfo();
        const offeringsResult = await Purchases.getOfferings().catch(() => null);
        if (task.cancelled) return;
        applyCustomerInfo(infoResult?.customerInfo);
        setOfferings(unwrapOfferings(offeringsResult));
      } catch {
        if (!task.cancelled) setOfferings(null);
      } finally {
        if (!task.cancelled) setIsLoading(false);
      }
    })();

    return () => {
      task.cancelled = true;
      if (task.listenerId) {
        Purchases.removeCustomerInfoUpdateListener({ listenerToRemove: task.listenerId }).catch(() => {});
      }
    };
  }, [nativeIos, applyCustomerInfo]);

  const purchasePackage = useCallback(async (pkg) => {
    const storePackage = pkg?.rcPackage || (pkg?.product ? pkg : null);
    if (!nativeIos) {
      return {
        status: 'unavailable',
        message: 'Subscriptions are purchased in the RootMap iOS app.',
        isPro: false
      };
    }
    if (!storePackage) {
      return {
        status: 'error',
        message: 'This plan is not available for purchase yet.',
        isPro: isProRef.current
      };
    }
    try {
      await ensureIosPurchases();
      const result = await Purchases.purchasePackage({ aPackage: storePackage });
      const pro = applyCustomerInfo(result?.customerInfo);
      if (pro) {
        return { status: 'purchased', message: 'RootMap Pro is active.', isPro: true };
      }
      return {
        status: 'error',
        message: 'Purchase finished, but RootMap Pro is not active yet.',
        isPro: false
      };
    } catch (error) {
      if (isPurchaseCancelled(error)) {
        return { status: 'cancelled', message: 'Purchase cancelled.', isPro: isProRef.current };
      }
      return {
        status: 'error',
        message: errorMessage(error) || 'Purchase could not be completed.',
        isPro: isProRef.current
      };
    }
  }, [nativeIos, applyCustomerInfo]);

  const restorePurchases = useCallback(async () => {
    if (!nativeIos) {
      return {
        status: 'none',
        message: 'No previous purchases found.',
        isPro: false
      };
    }
    try {
      await ensureIosPurchases();
      const { customerInfo } = await Purchases.restorePurchases();
      const pro = applyCustomerInfo(customerInfo);
      if (pro) {
        return {
          status: 'restored',
          message: 'Purchases restored. RootMap Pro is active.',
          isPro: true
        };
      }
      return {
        status: 'none',
        message: 'No previous purchases found for this Apple ID.',
        isPro: false
      };
    } catch (error) {
      return {
        status: 'error',
        message: errorMessage(error) || 'Could not restore purchases.',
        isPro: isProRef.current
      };
    }
  }, [nativeIos, applyCustomerInfo]);

  const value = useMemo(() => ({
    isPro,
    offerings,
    isLoading,
    purchasePackage,
    restorePurchases
  }), [isPro, offerings, isLoading, purchasePackage, restorePurchases]);

  return (
    <SubscriptionContext.Provider value={value}>
      {children}
    </SubscriptionContext.Provider>
  );
}
