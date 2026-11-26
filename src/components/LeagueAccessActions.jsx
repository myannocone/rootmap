import React, { useState } from 'react';
import { isOfferCodeCancellation, offerCodeFailureMessage, publicOfferCodeNotice } from '../utils/offerCodeErrors';

export default function LeagueAccessActions({
  isLight = false,
  disabled = false,
  onRedeemOfferCode,
  onUnlocked
}) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);

  const redeem = async () => {
    if (busy || disabled || !onRedeemOfferCode) return;
    setBusy(true);
    setNotice(null);
    let unlocked = false;
    try {
      const result = await onRedeemOfferCode();
      if (result?.isPro) {
        unlocked = true;
        onUnlocked?.(result);
        return;
      }
      const notice = publicOfferCodeNotice(result);
      if (notice) setNotice(notice);
    } catch (error) {
      if (isOfferCodeCancellation(error)) return;
      const message = offerCodeFailureMessage(error);
      if (!message) return;
      setNotice({
        tone: 'error',
        message
      });
    } finally {
      if (!unlocked) setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <button
        type="button"
        disabled={busy || disabled || !onRedeemOfferCode}
        onClick={redeem}
        className="w-full min-h-11 rounded-xl border text-[12px] font-black disabled:opacity-60"
        style={{
          color: isLight ? '#065F46' : '#6EE7B7',
          borderColor: isLight ? '#A7F3D0' : '#065F46',
          background: isLight ? '#ECFDF5' : 'rgba(16, 185, 129, 0.08)'
        }}
      >
        {busy ? 'Opening offer code…' : 'Redeem Offer Code'}
      </button>
      {notice ? (
        <p
          role="status"
          className="rounded-xl px-3 py-2 text-[12px] font-bold leading-snug"
          style={{
            background: notice.tone === 'error' ? 'rgba(244, 63, 94, 0.12)' : 'rgba(16, 185, 129, 0.12)',
            color: notice.tone === 'error' ? (isLight ? '#BE123C' : '#FDA4AF') : (isLight ? '#047857' : '#6EE7B7')
          }}
        >
          {notice.message}
        </p>
      ) : null}
    </div>
  );
}
