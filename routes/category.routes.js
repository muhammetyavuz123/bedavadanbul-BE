import express from "express";
const router = express.Router();
import { categoryLimiter } from "../middleware/rateLimit.js";
import { protect } from "../middleware/protect.js";
import { isAdmin } from "../middleware/isAdmin.js";

import {
  getCategories,
  createCategory,
  approveCategory,
  deleteCategory,
} from "../controllers/category.controller.js";

router.get("/", getCategories);
// ⚠️ FIX: Kategori önerme özelliği zaten sadece giriş yapmış kullanıcılara
// gösteriliyor (client'ta "/profile" altında, RequireAuth ile korunuyor),
// ama sunucu tarafında hiçbir auth kontrolü YOKTU — API'ye doğrudan istek
// atan herkes (giriş yapmadan) kategori "önerebiliyordu" ve bu yüzden
// createdBy her zaman "guest" olarak kaydediliyordu, gerçek öneren kullanıcı
// hiç tutulmuyordu. `protect` eklenerek hem bu boşluk kapatıldı hem de
// req.user artık dolu olduğu için categoryLimiter kullanıcı bazlı sayabiliyor.
router.post("/", protect, categoryLimiter, createCategory);
// ⚠️ Onaylama ve silme sadece adminlere açık olmalı
router.patch("/approve/:id", protect, isAdmin, approveCategory);
router.delete("/:id", protect, isAdmin, deleteCategory);

export default router;
