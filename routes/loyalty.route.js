import express from "express";
import { protect } from "../middleware/protect.js";
import { optionalAuth } from "../middleware/optionalAuth.js";
import {
  loyaltyQrLimiter,
  loyaltyScanLimiter,
  loyaltyClaimLimiter,
  loyaltyJoinLimiter,
  loyaltyProgramLimiter,
} from "../middleware/rateLimit.js";
import {
  getMyProgram,
  saveMyProgram,
  scanCustomer,
  lookupCoupon,
  useCoupon,
  listMyEvents,
  getMyQr,
  listMyCards,
  listMyCoupons,
  claimReward,
  getBusinessProgram,
  listPrograms,
  joinProgram,
} from "../controllers/loyalty.controller.js";

const router = express.Router();

// İşletme (işyeri hesabı)
router.get("/me/program", protect, getMyProgram);
router.put("/me/program", protect, loyaltyProgramLimiter, saveMyProgram);
router.get("/me/events", protect, listMyEvents);
router.post("/scan", protect, loyaltyScanLimiter, scanCustomer);
router.get("/coupons/lookup/:code", protect, loyaltyScanLimiter, lookupCoupon);
router.post("/coupons/use", protect, loyaltyScanLimiter, useCoupon);

// Müşteri
router.get("/qr", protect, loyaltyQrLimiter, getMyQr);
router.get("/cards", protect, listMyCards);
router.get("/coupons/mine", protect, listMyCoupons);
router.post("/cards/:cardId/claim", protect, loyaltyClaimLimiter, claimReward);

// Kampanyalar listesinde görünen programlar + katılma
router.get("/programs", optionalAuth, listPrograms);
router.post("/programs/:programId/join", protect, loyaltyJoinLimiter, joinProgram);

// Herkese açık işletme sayfası için (giriş isteğe bağlı)
router.get("/business/:businessId", optionalAuth, getBusinessProgram);

export default router;
