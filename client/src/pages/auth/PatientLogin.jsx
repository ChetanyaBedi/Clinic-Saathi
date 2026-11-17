import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Smartphone } from 'lucide-react';
import { api } from '../../lib/api.js';
import { useAuth } from '../../hooks/useAuth.jsx';
import { Spinner } from '../../components/ui/States.jsx';
import { AuthLayout } from './AuthLayout.jsx';

// Only the clinic code and phone number are remembered on this device, never a code or session.
const REMEMBER_KEY = 'cs_patient_login';
function readRemembered() {
  try { return JSON.parse(localStorage.getItem(REMEMBER_KEY) || 'null') || {}; } catch { return {}; }
}
function rememberDevice(value) {
  try { localStorage.setItem(REMEMBER_KEY, JSON.stringify(value)); } catch { /* storage unavailable */ }
}

/**
 * Patients sign in to one clinic's portal with a one-time code to their
 * mobile. A registered number goes straight to the code; only a new number
 * is asked for a name and consent.
 */
export default function PatientLogin() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { patientVerify, patientRegister, user, loading } = useAuth();
  const remembered = readRemembered();
  const [step, setStep] = useState('phone');
  const [form, setForm] = useState({
    phone: params.get('phone') || remembered.phone || '',
    code: '', name: '', consent: false,
  });
  const [regToken, setRegToken] = useState(null);
  const [state, setState] = useState({ busy: false, error: null, info: null });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const phone = form.phone.startsWith('+') ? form.phone : `+91${form.phone.replace(/\D/g, '').slice(-10)}`;
  // The clinic comes from the link the patient opened (or this device's last sign-in), never typed.
  const clinicSlug = (params.get('clinic') || remembered.clinicSlug || '').trim().toLowerCase();

  // Already signed in as a patient: no need to sign in again.
  useEffect(() => {
    if (!loading && user?.role === 'PATIENT') navigate('/patient/dashboard', { replace: true });
  }, [loading, user, navigate]);

  const run = async (fn) => {
    setState({ busy: true, error: null });
    try { await fn(); } catch (e) { setState({ busy: false, error: e.details?.[0]?.message || e.message }); return; }
    setState((s) => ({ ...s, busy: false }));
  };

  const requestCode = () => run(async () => {
    const r = await api.post('/auth/patient/request-otp', { clinicSlug, phone });
    setStep('code');
    setState({ busy: false, info: r.data.data.message });
  });

  // Takes the code as an argument so the six-digit auto-submit uses the value just typed.
  const verify = (code = form.code) => run(async () => {
    const r = await patientVerify({ clinicSlug, phone, code });
    rememberDevice({ clinicSlug, phone: form.phone });
    if (r.needsRegistration) { setRegToken(r.registrationToken); setStep('register'); return; }
    navigate('/patient/dashboard', { replace: true });
  });

  const register = () => run(async () => {
    await patientRegister({ registrationToken: regToken, name: form.name, consentGiven: true });
    rememberDevice({ clinicSlug, phone: form.phone });
    navigate('/patient/dashboard', { replace: true });
  });

  const onCodeChange = (e) => {
    const code = e.target.value.replace(/\D/g, '').slice(0, 6);
    set('code', code);
    if (code.length === 6 && !state.busy) verify(code);
  };

  return (
    <AuthLayout heading="Your appointments, prescriptions and reports in one place." sub="Book, reschedule, see your queue position and download released reports — securely, with a code sent to your phone.">
      <h1 className="font-display text-2xl font-semibold">Patient sign-in</h1>
      <p className="mt-1.5 text-sm text-ink-muted">We'll send a 6-digit code to your mobile number.</p>

      <div className="mt-7 space-y-4">
        {step === 'phone' && !clinicSlug && (
          <p className="rounded-lg bg-pulse-soft px-3 py-2 text-sm text-pulse-deep">
            Open the sign-in link from your clinic to continue.
          </p>
        )}

        {step === 'phone' && clinicSlug && (
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (!state.busy && form.phone.replace(/\D/g, '').length >= 10) requestCode(); }}>
            <div>
              <label className="label" htmlFor="pl-phone">Mobile number</label>
              <div className="relative">
                <Smartphone className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
                <input id="pl-phone" type="tel" inputMode="tel" autoComplete="tel" className="field pl-9" placeholder="98765 43210" value={form.phone} onChange={(e) => set('phone', e.target.value)} />
              </div>
            </div>
            <button type="submit" className="btn-primary w-full" disabled={state.busy || form.phone.replace(/\D/g, '').length < 10}>
              {state.busy && <Spinner />} Send code
            </button>
          </form>
        )}

        {step === 'code' && (
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (!state.busy && form.code.length === 6) verify(); }}>
            {state.info && <p className="rounded-lg bg-pulse-soft px-3 py-2 text-sm text-pulse-deep">{state.info}</p>}
            <div>
              <label className="label" htmlFor="pl-code">6-digit code</label>
              <input id="pl-code" inputMode="numeric" autoComplete="one-time-code" autoFocus maxLength={6} className="field text-center font-mono text-lg tracking-[0.5em]"
                     value={form.code} onChange={onCodeChange} />
            </div>
            <button type="submit" className="btn-primary w-full" disabled={state.busy || form.code.length !== 6}>{state.busy && <Spinner />} Sign in</button>
            <button type="button" className="btn-quiet w-full text-sm" onClick={() => { setStep('phone'); set('code', ''); setState({ busy: false, error: null, info: null }); }}>Use a different number</button>
          </form>
        )}

        {step === 'register' && (
          <>
            <p className="rounded-lg bg-pulse-soft px-3 py-2 text-sm text-pulse-deep">New number. Tell us who you are to create your account.</p>
            <div>
              <label className="label" htmlFor="pl-name">Full name</label>
              <input id="pl-name" className="field" autoComplete="name" value={form.name} onChange={(e) => set('name', e.target.value)} />
            </div>
            <label className="flex items-start gap-2.5 text-sm text-ink-soft">
              <input type="checkbox" className="mt-0.5" checked={form.consent} onChange={(e) => set('consent', e.target.checked)} />
              <span>I agree that the clinic may store my health and contact details to provide care and contact me about my appointments.</span>
            </label>
            <button className="btn-primary w-full" disabled={state.busy || form.name.trim().length < 2 || !form.consent} onClick={register}>{state.busy && <Spinner />} Create my account</button>
          </>
        )}

        {state.error && <p role="alert" className="rounded-lg bg-alert-soft px-3 py-2 text-sm text-alert">{state.error}</p>}
      </div>

    </AuthLayout>
  );
}
