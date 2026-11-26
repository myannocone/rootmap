import React, { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Capacitor } from '@capacitor/core';
import RootMapLogo from './Logo';
import LeagueAccessActions from './LeagueAccessActions';
import { SITE_ORIGIN } from '../utils/siteOrigin';
import { isOfferCodeCancellation, offerCodeFailureMessage, publicOfferCodeNotice } from '../utils/offerCodeErrors';

const PACKAGE_SPECS = [
  {
    id: 'rootmap_pro_season_pass',
    title: '6-Month Pass',
    priceString: '$14.99',
    cadence: '6 months',
    detail: '$14.99 / 6 months',
    highlight: 'Best value'
  },
  {
    id: 'rootmap_pro_monthly',
    title: 'Monthly',
    priceString: '$4.99',
    cadence: 'month',
    detail: '$4.99 / month',
    highlight: ''
  }
];

const VALUE_POINTS = [
  'Unlimited Leagues across Yahoo, ESPN & Sleeper',
  'Cross-League Overlap & Rooting Insights',
  'Live Active-Week Alerts'
];

function packageIds(pkg) {
  return [pkg?.identifier, pkg?.product?.identifier]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
}

function offeringsPackages(offerings) {
  const lists = [];
  if (offerings?.current?.availablePackages) lists.push(offerings.current.availablePackages);
  Object.values(offerings?.all || {}).forEach((offering) => {
    if (offering?.availablePackages) lists.push(offering.availablePackages);
  });
  return lists.flat();
}

function packagesFromOfferings(offerings) {
  const available = offeringsPackages(offerings);
  return PACKAGE_SPECS.map((spec) => {
    const match = available.find((pkg) => packageIds(pkg).includes(spec.id));
    const priceString = match?.product?.priceString || spec.priceString;
    return {
      ...spec,
      priceString,
      detail: `${priceString} / ${spec.cadence}`,
      rcPackage: match || null,
      preview: !match
    };
  });
}

async function openLegal(path) {
  const native = Capacitor.getPlatform() === 'ios';
  const url = native ? `${SITE_ORIGIN}${path}` : path;
  if (native) {
    try {
      const { Browser } = await import('@capacitor/browser');
      await Browser.open({ url });
      return;
    } catch {
      // Fall through to a normal navigation if the in-app browser cannot open.
    }
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}

export default function ProPaywall({
  offerings,
  isLoading = false,
  onClose,
  onPurchase,
  onRestore,
  onRedeemOfferCode,
  onAccessUnlocked
}) {
  const packages = useMemo(() => packagesFromOfferings(offerings), [offerings]);
  const [selectedId, setSelectedId] = useState(PACKAGE_SPECS[0].id);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState(null);
  const selected = packages.find((pkg) => pkg.id === selectedId) || packages[0];

  const run = async (kind, action) => {
    if (busy) return;
    setBusy(kind);
    setNotice(null);
    try {
      const result = await action();
      if (result?.isPro) return;
      const next = publicOfferCodeNotice(result);
      if (next) setNotice(next);
    } catch (error) {
      if (isOfferCodeCancellation(error)) return;
      setNotice({
        tone: 'error',
        message: offerCodeFailureMessage(error) || 'Something went wrong. Try again.'
      });
    } finally {
      setBusy('');
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[95] flex items-stretch justify-center"
      style={{ background: 'rgba(2, 6, 12, 0.78)' }}
      role="presentation"
      onClick={onClose}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="pro-upgrade-title"
        className="w-full max-w-md h-full overflow-y-auto shadow-2xl"
        style={{ background: '#0A0F14' }}
      >
        <div
          className="min-h-full flex flex-col px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]"
          style={{ paddingTop: 'calc(0.85rem + env(safe-area-inset-top))' }}
        >
          <div className="flex items-center justify-between gap-3">
            <RootMapLogo className="w-9 h-9" showWordmark />
            <button
              type="button"
              aria-label="Close RootMap Pro"
              onClick={onClose}
              className="w-10 h-10 rounded-full flex items-center justify-center text-lg font-bold"
              style={{ background: '#162029', color: '#E2E8F0' }}
            >
              ✕
            </button>
          </div>

          <div className="mt-5">
            <div
              className="inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.16em]"
              style={{ background: 'rgba(16, 185, 129, 0.16)', color: '#6EE7B7' }}
            >
              RootMap Pro
            </div>
            <h3 id="pro-upgrade-title" className="mt-3 text-[1.65rem] leading-tight font-black text-white">
              Every league. One board.
            </h3>
            <p className="mt-2 text-[13px] font-semibold leading-snug" style={{ color: '#94A3B8' }}>
              Keep Yahoo, ESPN, and Sleeper active together — no 2-league swap.
            </p>
          </div>

          <ul className="mt-5 space-y-2.5">
            {VALUE_POINTS.map((point) => (
              <li key={point} className="flex items-start gap-3">
                <span
                  className="mt-0.5 w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-black shrink-0"
                  style={{ background: '#10B981', color: '#042117' }}
                  aria-hidden="true"
                >
                  ✓
                </span>
                <span className="text-[13.5px] font-bold leading-snug text-white">{point}</span>
              </li>
            ))}
          </ul>

          <div className="mt-5 space-y-2.5" role="radiogroup" aria-label="RootMap Pro plans">
            {packages.map((pkg) => {
              const active = pkg.id === selected?.id;
              return (
                <button
                  key={pkg.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => {
                    setSelectedId(pkg.id);
                    setNotice(null);
                  }}
                  className="w-full text-left rounded-2xl px-3.5 py-3 flex items-center gap-3"
                  style={{
                    background: active ? 'rgba(16, 185, 129, 0.12)' : '#101820',
                    border: active ? '2px solid #10B981' : '1px solid #1E2A34',
                    boxShadow: active ? '0 0 0 1px rgba(16, 185, 129, 0.25)' : 'none'
                  }}
                >
                  <span
                    className="w-5 h-5 rounded-full flex items-center justify-center shrink-0"
                    style={{
                      border: active ? '6px solid #10B981' : '2px solid #475569',
                      background: '#0A0F14'
                    }}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="text-sm font-black text-white">{pkg.title}</span>
                      {pkg.highlight ? (
                        <span
                          className="rounded-full px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide"
                          style={{ background: '#10B981', color: '#042117' }}
                        >
                          {pkg.highlight}
                        </span>
                      ) : null}
                    </span>
                    <span className="block mt-0.5 text-[11px] font-semibold" style={{ color: '#94A3B8' }}>
                      {pkg.id === 'rootmap_pro_season_pass' ? 'Billed every 6 months' : 'Billed every month'}
                      {isLoading && !pkg.rcPackage ? ' · loading App Store price' : ''}
                    </span>
                  </span>
                  <span className="text-right shrink-0">
                    <span className="block text-sm font-black text-white">{pkg.priceString}</span>
                    <span className="block text-[10px] font-bold" style={{ color: '#94A3B8' }}>
                      / {pkg.cadence}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          <p className="mt-3 text-[10.5px] font-semibold leading-relaxed" style={{ color: '#64748B' }}>
            Payment charges to your Apple ID. The plan renews unless you cancel at least 24 hours before the period ends. Manage or cancel in Settings → Apple ID → Subscriptions.
          </p>

          {notice ? (
            <p
              role="status"
              className="mt-3 rounded-xl px-3 py-2 text-[12px] font-bold leading-snug"
              style={{
                background: notice.tone === 'error' ? 'rgba(244, 63, 94, 0.12)' : 'rgba(16, 185, 129, 0.12)',
                color: notice.tone === 'error' ? '#FDA4AF' : '#6EE7B7'
              }}
            >
              {notice.message}
            </p>
          ) : null}

          <div className="mt-auto pt-4 space-y-2">
            <button
              type="button"
              disabled={!selected || Boolean(busy)}
              onClick={() => run('purchase', () => onPurchase(selected))}
              className="w-full min-h-12 rounded-2xl text-sm font-black disabled:opacity-60"
              style={{ background: '#10B981', color: '#042117' }}
            >
              {busy === 'purchase' ? 'Connecting to the App Store…' : `Continue — ${selected?.priceString || ''}`}
            </button>
            <button
              type="button"
              disabled={Boolean(busy)}
              onClick={() => run('restore', () => onRestore())}
              className="w-full min-h-11 rounded-2xl text-[13px] font-black disabled:opacity-60"
              style={{ color: '#6EE7B7', background: 'transparent' }}
            >
              {busy === 'restore' ? 'Restoring…' : 'Restore Purchases'}
            </button>
            {onRedeemOfferCode ? (
              <LeagueAccessActions
                isLight={false}
                disabled={Boolean(busy)}
                onRedeemOfferCode={onRedeemOfferCode}
                onUnlocked={onAccessUnlocked}
              />
            ) : null}
            <div className="flex items-center justify-center gap-3 pt-1 text-[12px] font-bold">
              <button
                type="button"
                onClick={() => openLegal('/terms')}
                className="underline underline-offset-2"
                style={{ color: '#94A3B8' }}
              >
                Terms of Use
              </button>
              <span aria-hidden="true" style={{ color: '#334155' }}>·</span>
              <button
                type="button"
                onClick={() => openLegal('/privacy')}
                className="underline underline-offset-2"
                style={{ color: '#94A3B8' }}
              >
                Privacy Policy
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
