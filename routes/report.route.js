import express from "express";
import { protect } from "../middleware/protect.js";
import { isAdmin } from "../middleware/isAdmin.js";
import { reportLimiter, blockLimiter } from "../middleware/rateLimit.js";
import {
  createReport,
  listBlocks,
  blockUser,
  unblockUser,
  adminListReports,
  adminResolveReport,
} from "../controllers/report.controller.js";

const router = express.Router();

// ⚠️ Sıralama önemli: sabit yollar dinamik yollardan ÖNCE gelmeli.

// Yönetici
router.get("/admin/all", protect, isAdmin, adminListReports);
router.post("/admin/:id/resolve", protect, isAdmin, adminResolveReport);

// Engelleme
router.get("/blocks", protect, listBlocks);
router.post("/blocks/:userId", protect, blockLimiter, blockUser);
router.delete("/blocks/:userId", protect, unblockUser);

// Şikâyet gönder
router.post("/", protect, reportLimiter, createReport);

export default router;
