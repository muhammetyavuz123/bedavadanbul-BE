import express from "express";
import { protect } from "../middleware/protect.js";
import { isAdmin } from "../middleware/isAdmin.js";
import { assistantMissLimiter } from "../middleware/rateLimit.js";
import {
  logMiss,
  adminListMisses,
  adminClearMisses,
} from "../controllers/assistant.controller.js";

const router = express.Router();

// Yönetici
router.get("/admin/misses", protect, isAdmin, adminListMisses);
router.post("/admin/misses/clear", protect, isAdmin, adminClearMisses);

// Herkese açık (giriş gerekmez): bulunamayan aramayı kaydet
router.post("/miss", assistantMissLimiter, logMiss);

export default router;
