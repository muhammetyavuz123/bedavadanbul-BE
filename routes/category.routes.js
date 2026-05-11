import express from "express";
const router = express.Router();
import { categoryLimiter } from "../middleware/rateLimit.js";

import {
  getCategories,
  createCategory,
  approveCategory,
  deleteCategory,
} from "../controllers/category.controller.js";

router.get("/", getCategories);
router.post("/", categoryLimiter, createCategory);
router.patch("/approve/:id", approveCategory);
router.delete("/:id", deleteCategory);

export default router;
