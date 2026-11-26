export const OFFER_CODE_INVALID_MESSAGE = "That offer code isn't valid or isn't active yet. Double-check the code or try again later.";

function nestedText(error) {
  const nested = [error?.cause, error?.underlyingError, error?.userInfo?.NSUnderlyingError];
  return nested.map((item) => {
    if (!item) return '';
    if (typeof item === 'string') return item;
    return `${item.domain || ''} ${item.code ?? ''} ${item.message || item.localizedDescription || ''}`;
  }).filter(Boolean).join(' ');
}

function errorParts(error) {
  if (!error) return { message: '', code: '', domain: '' };
  if (typeof error === 'string') return { message: error, code: '', domain: '' };
  const message = [
    error.message,
    error.underlyingErrorMessage,
    error.localizedDescription,
    error.userInfo?.NSLocalizedDescription,
    nestedText(error)
  ].filter((part) => typeof part === 'string' && part.trim()).join(' ');
  const code = String(error.code ?? error.errorCode ?? '');
  const domain = String(error.domain || error.userInfo?.NSErrorDomain || '');
  return { message: message.trim(), code, domain };
}

function blob({ message, code, domain }) {
  return `${domain} ${code} ${message}`.toLowerCase();
}

export function isInvalidOfferCodeError(error) {
  const parts = errorParts(error);
  const text = blob(parts);
  if (parts.code === 'INVALID_OFFER_CODE') return true;
  if (/skinternalerrordomain/.test(text) && /\b12\b/.test(text)) return true;
  if (parts.domain === 'SKInternalErrorDomain' && parts.code === '12') return true;
  // SKError invalid offer identifier, missing params, invalid price, ineligible.
  if (['11', '13', '14', '18'].includes(parts.code) && /offer|storekit|skerror/.test(text)) return true;
  if (/invalid (offer|code)|offer code.*(invalid|inactive|not active|expired)|code is not valid|isn'?t active|not active yet/.test(text)) {
    return true;
  }
  return false;
}

export function isOfferCodeCancellation(error) {
  if (!error || isInvalidOfferCodeError(error)) return false;
  if (error.userCancelled || error.userCanceled) return true;
  const parts = errorParts(error);
  const text = blob(parts);
  if (parts.code === '1' || parts.code === '2' || parts.code === '15') return true;
  if (parts.code === 'PURCHASE_CANCELLED_ERROR') return true;
  if (/overlay.?cancel|payment.?cancel|user cancel|sheet (was )?(closed|dismissed)|payment sheet dismissed/.test(text)) {
    return true;
  }
  return /\bcancel(?:led|ed)?\b/.test(text);
}

export function offerCodeFailureMessage(error) {
  if (isOfferCodeCancellation(error)) return '';
  if (isInvalidOfferCodeError(error)) return OFFER_CODE_INVALID_MESSAGE;
  const { message } = errorParts(error);
  if (/skinternalerrordomain/i.test(message) && /\b12\b/.test(message)) return OFFER_CODE_INVALID_MESSAGE;
  if (/SKInternalErrorDomain|SKErrorDomain/i.test(message)) {
    return 'Offer code redemption could not be completed. Try again.';
  }
  return message;
}

/** Banner copy for an offer-code result. Cancellations return null so the UI stays quiet. */
export function publicOfferCodeNotice(result) {
  if (!result || result.status === 'cancelled') return null;
  const raw = typeof result === 'string' ? result : String(result.message || '');
  if (!raw.trim()) return null;
  if (result.status !== 'pending' && isOfferCodeCancellation(raw)) return null;
  if (isInvalidOfferCodeError(raw) || /skinternalerrordomain/i.test(raw)) {
    return { tone: 'error', message: OFFER_CODE_INVALID_MESSAGE };
  }
  if (/skerrordomain/i.test(raw)) {
    return { tone: 'error', message: 'Offer code redemption could not be completed. Try again.' };
  }
  return {
    tone: result.status === 'error' ? 'error' : 'info',
    message: raw
  };
}
