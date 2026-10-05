import express from "express";
import { protect } from "../middleware/protect.js";
import { isAdmin } from "../middleware/isAdmin.js";
import { pushAdminLimiter, pushRegisterLimiter } from "../middleware/rateLimit.js";
import {
  listMine,
  unreadCount,
  markAllRead,
  markRead,
  removeOne,
  registerDevice,
  unregisterDevice,
  adminPreview,
  adminSend,
  adminHistory,
} from "../controllers/notification.controller.js";

const router = express.Router();

// ⚠️ Sıralama önemli: sabit yollar "/:id" yollarından ÖNCE gelmeli.

// Yönetici
router.post("/admin/preview", protect, isAdmin, adminPreview);
router.post("/admin/send", protect, isAdmin, pushAdminLimiter, adminSend);
router.get("/admin/history", protect, isAdmin, adminHistory);

// Cihaz kaydı (ileride telefon bildirimi için)
router.post("/devices", protect, pushRegisterLimiter, registerDevice);
router.post("/devices/remove", protect, unregisterDevice);

// Bildirim kutusu
router.get("/", protect, listMine);
router.get("/unread-count", protect, unreadCount);
router.post("/read-all", protect, markAllRead);
router.post("/:id/read", protect, markRead);
router.delete("/:id", protect, removeOne);

export default router;
