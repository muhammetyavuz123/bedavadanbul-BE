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
router.post("/", categoryLimiter, createCategory);
// ⚠️ Onaylama ve silme sadece adminlere açık olmalı
router.patch("/approve/:id", protect, isAdmin, approveCategory);
router.delete("/:id", protect, isAdmin, deleteCategory);

export default router;
