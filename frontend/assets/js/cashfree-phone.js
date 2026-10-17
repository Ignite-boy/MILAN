'use strict';

function normalizeCashfreePhone(value) {
  let digits = String(value || '').replace(/\D/g, '');

  // Cashfree PG uses a 10-digit customer_phone. Accept common Indian
  // forms: plain 10 digits, +91-prefixed, or a leading trunk zero.
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);

  return /^\d{10}$/.test(digits) ? digits : null;
}

if (typeof module === 'object' && module.exports) {
  module.exports = normalizeCashfreePhone;
}
if (typeof window !== 'undefined') {
  window.MilanNormalizeCashfreePhone = normalizeCashfreePhone;
}
