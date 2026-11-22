import React, { useState } from 'react';

export default function LeagueAccessActions({
  isLight = false,
  disabled = false,
  onRedeemOfferCode,
  onRedeemFriendsPass,
  onUnlocked
}) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState(null);
  const muted = isLight ? '#64748B' : '#94A3B8';
  const fieldBg = isLight ? '#FFFFFF' : '#0B1220';
  const fieldBorder = isLight ? '#CBD5E1' : '#334155';
  const fieldText = isLight ? '#0F172A' : '#F8FAFC';

  const run = async (kind, action) => {
    if (busy || disabled) return;
    setBusy(kind);
    setNotice(null);
    let unlocked = false;
    try {
      const result = await action();
      if (result?.isPro) {
        unlocked = true;
        onUnlocked?.(result);
        return;
      }
      if (result?.status === 'cancelled') return;
      if (result?.message) {
        setNotice({
          tone: result.status === 'error' ? 'error' : 'info',
          message: result.message
        });
      }
    } catch (error) {
      setNotice({
        tone: 'error',
        message: error?.message || 'Something went wrong. Try again.'
      });
    } finally {
      if (!unlocked) setBusy('');
    }
  };

  return (
    <div className="space-y-2">
      <button
        type="button"
        disabled={Boolean(busy) || disabled}
        onClick={() => run('offer', () => onRedeemOfferCode())}
        className="w-full min-h-11 rounded-xl border text-[12px] font-black disabled:opacity-60"
        style={{
          color: isLight ? '#065F46' : '#6EE7B7',
          borderColor: isLight ? '#A7F3D0' : '#065F46',
          background: isLight ? '#ECFDF5' : 'rgba(16, 185, 129, 0.08)'
        }}
      >
        {busy === 'offer' ? 'Opening offer code…' : 'Redeem Offer Code'}
      </button>
      <form
        className="flex items-center gap-1.5"
        onSubmit={(event) => {
          event.preventDefault();
          run('friends', () => onRedeemFriendsPass(code));
        }}
      >
        <input
          value={code}
          onChange={(event) => {
            setCode(event.target.value);
            setNotice(null);
          }}
          aria-label="Friends Pass code"
          placeholder="Friends pass code"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          disabled={Boolean(busy) || disabled}
          className="min-w-0 flex-1 min-h-11 rounded-xl border px-3 text-[12px] font-bold"
          style={{ background: fieldBg, borderColor: fieldBorder, color: fieldText }}
        />
        <button
          type="submit"
          disabled={Boolean(busy) || disabled}
          className="shrink-0 min-h-11 px-3 rounded-xl text-[11px] font-black disabled:opacity-60"
          style={{ background: '#10B981', color: '#042117' }}
        >
          {busy === 'friends' ? 'Applying…' : 'Apply'}
        </button>
      </form>
      <p className="text-[10px] font-semibold leading-snug" style={{ color: muted }}>
        Friends Pass unlocks unlimited leagues for this season and does not start a paid subscription.
      </p>
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
