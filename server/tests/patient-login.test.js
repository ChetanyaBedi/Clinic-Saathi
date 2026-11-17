import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, makeClinic } from './helpers.js';

const ctx = await setup('patient-login');
const A = await makeClinic(ctx, { slug: 'sunrise' });
test.after(() => ctx.teardown());

// A patient saved the way reception saves them: 10 digits, no country code.
const RECEPTION_PHONE = '9811122233';

test('a patient already on file signs in with OTP and is not asked to register again', async () => {
  const patient = await ctx.models.Patient.create({
    clinicId: A.clinic._id, name: 'Asha Existing', phone: RECEPTION_PHONE,
    consent: { dataProcessing: { granted: true, grantedAt: new Date(), version: 'v1' } },
  });

  // The portal sends the number in +91 form, which must match the reception record.
  const { lastStubTo } = await import('../src/integrations/stubOutbox.js');
  const req = await ctx.api('POST', '/auth/patient/request-otp', { body: { clinicSlug: 'sunrise', phone: `+91${RECEPTION_PHONE}` } });
  assert.equal(req.status, 200);
  const code = lastStubTo(`+91${RECEPTION_PHONE}`).body.match(/\d{6}/)[0];
  const verify = await ctx.api('POST', '/auth/patient/verify-otp', { body: { clinicSlug: 'sunrise', phone: `+91${RECEPTION_PHONE}`, code } });

  assert.equal(verify.status, 200);
  assert.equal(verify.data.needsRegistration, undefined, 'a registered patient must not be sent to registration');
  assert.ok(verify.data.accessToken);
  assert.equal(verify.data.user.patientId, String(patient._id));
  const copies = await ctx.models.Patient.find({ phone: { $in: [RECEPTION_PHONE, `+91${RECEPTION_PHONE}`] } }).setOptions({ clinicId: A.clinic._id });
  assert.equal(copies.length, 1, 'no duplicate patient record is created');
});

test('a number not registered at this clinic gets no login code', async () => {
  const { lastStubTo } = await import('../src/integrations/stubOutbox.js');
  const stranger = '+919811100000';
  const req = await ctx.api('POST', '/auth/patient/request-otp', { body: { clinicSlug: 'sunrise', phone: stranger } });
  assert.equal(req.status, 404);
  assert.equal(req.body.code, 'NOT_REGISTERED');
  assert.equal(lastStubTo(stranger), undefined, 'no WhatsApp message is sent to an unregistered number');
});

test('a patient registered at another clinic cannot get a code here', async () => {
  const B = await makeClinic(ctx, { slug: 'other-clinic' });
  await ctx.models.Patient.create({
    clinicId: B.clinic._id, name: 'Elsewhere', phone: '+919811199999',
    consent: { dataProcessing: { granted: true, grantedAt: new Date(), version: 'v1' } },
  });
  const req = await ctx.api('POST', '/auth/patient/request-otp', { body: { clinicSlug: 'sunrise', phone: '+919811199999' } });
  assert.equal(req.status, 404);
  assert.equal(req.body.code, 'NOT_REGISTERED');
});

test('a number on a clinic staff login cannot sign in to the patient portal', async () => {
  const { lastStubTo } = await import('../src/integrations/stubOutbox.js');
  const phone = '+919811177777';
  const owner = new ctx.models.User({ name: 'Sunrise Owner', email: 'owner@sunrise.test', phone: '9811177777', role: 'CLINIC_OWNER', clinicId: A.clinic._id });
  await owner.setPassword('Password123');
  await owner.save();
  await ctx.models.Patient.create({
    clinicId: A.clinic._id, name: 'Owner As Patient', phone: '9811177777',
    consent: { dataProcessing: { granted: true, grantedAt: new Date(), version: 'v1' } },
  });

  const req = await ctx.api('POST', '/auth/patient/request-otp', { body: { clinicSlug: 'sunrise', phone } });
  assert.equal(req.status, 403);
  assert.equal(req.body.code, 'STAFF_NUMBER');
  assert.equal(lastStubTo(phone), undefined, 'no code is sent to a staff number');

  const verify = await ctx.api('POST', '/auth/patient/verify-otp', { body: { clinicSlug: 'sunrise', phone, code: '123456' } });
  assert.equal(verify.status, 403, 'a staff number is refused at verification too');
});
