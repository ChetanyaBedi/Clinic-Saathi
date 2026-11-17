import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import * as ctrl from './auth.controller.js';
import { validate } from '../../middleware/validate.js';
import { authenticate } from '../../middleware/auth.js';
import { env } from '../../config/env.js';
import { ApiError } from '../../utils/ApiError.js';

const router = Router();

// Profile photos are small: a 2 MB cap and only web image formats.
const AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
  // multer drops a file unless the callback says true, so accept it explicitly.
  fileFilter: (_req, file, cb) => (AVATAR_TYPES.includes(file.mimetype)
    ? cb(null, true)
    : cb(ApiError.badRequest('Upload a JPG, PNG or WebP image', 'UNSUPPORTED_IMAGE'))),
});

// Every login-style endpoint allows 5 requests per 15 minutes. The count is kept
// per IP *and* per identifier (email, phone or clinic), so one clinic's shared
// WiFi can't lock out its whole staff, while guessing against one account is capped.
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX = 5;
const loginLimiter = rateLimit({
  windowMs: LOGIN_WINDOW_MS,
  max: LOGIN_MAX * env.rateLimitMultiplier,
  standardHeaders: true,
  legacyHeaders: false,
  // Admin's own IPs (SUPER_ADMIN_IPS) are never limited; everyone else is.
  skip: (req) => env.superAdminIps.includes(req.ip),
  keyGenerator: (req) => {
    const who = req.body?.identifier || req.body?.email || req.body?.phone || req.body?.clinicSlug
      || String(req.body?.registrationToken || '').slice(-24);
    return `${req.ip}|${String(who).trim().toLowerCase()}`;
  },
  message: { success: false, message: 'Too many attempts. Wait a few minutes and try again.', code: 'RATE_LIMITED' },
});

// No public sign-up: clinics and their logins are provisioned by the super admin.
router.post('/login', loginLimiter, validate(ctrl.loginSchema), ctrl.login);
router.post('/refresh', ctrl.refresh);
router.post('/logout', ctrl.logout);
router.post('/forgot-password', loginLimiter, validate(ctrl.forgotSchema), ctrl.forgotPassword);
router.post('/reset-password', loginLimiter, validate(ctrl.resetSchema), ctrl.resetPassword);
router.post('/change-password', authenticate, validate(ctrl.changePasswordSchema), ctrl.changePassword);

router.post('/patient/request-otp', loginLimiter, validate(ctrl.otpRequestSchema), ctrl.patientRequestOtp);
router.post('/patient/verify-otp', loginLimiter, validate(ctrl.otpVerifySchema), ctrl.patientVerifyOtp);
router.post('/patient/register', loginLimiter, validate(ctrl.patientRegisterSchema), ctrl.patientRegister);

router.get('/me', authenticate, ctrl.me);
router.put('/me/avatar', authenticate, avatarUpload.single('photo'), ctrl.uploadAvatar);
router.delete('/me/avatar', authenticate, ctrl.removeAvatar);

export default router;
