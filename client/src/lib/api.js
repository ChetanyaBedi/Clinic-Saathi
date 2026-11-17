import axios from 'axios';

// Sessions live in httpOnly cookies that the server sets. The browser attaches
// them on every request, and page scripts never see the tokens, so nothing
// session-related is kept in localStorage.
export const api = axios.create({ baseURL: '/api', withCredentials: true });

// Older builds stored tokens in localStorage. Remove them so they can't linger.
try {
  localStorage.removeItem('cs_access');
  localStorage.removeItem('cs_refresh');
} catch { /* storage unavailable */ }

// Requests that must never trigger a refresh: the auth calls themselves, and
// sign-in or reset flows where a 401 means "wrong password", not "expired session".
const NO_REFRESH = ['/auth/login', '/auth/refresh', '/auth/logout', '/auth/patient/', '/auth/forgot-password', '/auth/reset-password'];

// Many requests can fail at once when the access cookie expires. They all share one refresh.
let refreshing = null;
function refreshSession() {
  refreshing = refreshing || axios.post('/api/auth/refresh', null, { withCredentials: true })
    .finally(() => { refreshing = null; });
  return refreshing;
}

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config || {};
    const skip = NO_REFRESH.some((p) => original.url?.startsWith(p));

    // The access cookie is short-lived. A 401 means refresh it once, then replay the request.
    if (error.response?.status === 401 && !original._retried && !skip) {
      original._retried = true;
      try {
        await refreshSession();
        return api(original);
      } catch {
        // The refresh cookie is gone or expired, so the session is over. The app's route guards handle the redirect.
        window.dispatchEvent(new Event('cs:session-expired'));
      }
    }

    // Normalise the server's error shape so callers always get .message and .code
    return Promise.reject({
      message: error.response?.data?.message || 'Could not reach the server',
      code: error.response?.data?.code || 'NETWORK_ERROR',
      details: error.response?.data?.details,
      status: error.response?.status,
    });
  }
);

export const unwrap = (res) => res.data.data;
/** For paginated endpoints: { data, meta }. */
export const unwrapPage = (res) => ({ data: res.data.data, meta: res.data.meta || {} });

/**
 * Opens a private file. The API checks access, then returns a five-minute
 * signed link — nothing medical is ever served from a permanent public URL.
 */
export async function openFile(kind, id) {
  const tab = window.open('', '_blank');
  try {
    const { url } = unwrap(await api.post('/files/sign', { kind, id }));
    if (tab) tab.location.href = url; else window.location.href = url;
  } catch (e) {
    tab?.close();
    throw e;
  }
}

/** Authenticated CSV download (the export endpoints need the session cookie). */
export async function downloadCsv(path, filename) {
  const res = await api.get(path, { responseType: 'blob' });
  const href = URL.createObjectURL(res.data);
  const a = Object.assign(document.createElement('a'), { href, download: filename });
  a.click();
  URL.revokeObjectURL(href);
}

/** Loads Razorpay Checkout on demand and resolves with its signed response. */
export function razorpayCheckout({ keyId, order, name, description, prefill }) {
  return new Promise((resolve, reject) => {
    const open = () => {
      const rzp = new window.Razorpay({
        key: keyId, order_id: order.id, amount: order.amount, currency: order.currency || 'INR',
        name, description, prefill,
        handler: resolve,
        modal: { ondismiss: () => reject({ message: 'Payment cancelled', code: 'PAYMENT_CANCELLED' }) },
      });
      rzp.on('payment.failed', (r) => reject({ message: r.error?.description || 'Payment failed', code: 'PAYMENT_FAILED' }));
      rzp.open();
    };
    if (window.Razorpay) return open();
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.onload = open;
    s.onerror = () => reject({ message: 'Could not load the payment window', code: 'CHECKOUT_LOAD_FAILED' });
    document.body.appendChild(s);
  });
}
