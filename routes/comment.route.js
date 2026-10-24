import express from "express";
import {
  getComment,
  postComment,
  deleteComment,
} from "../controllers/comments.controller.js";
import { protect } from "../middleware/protect.js";
import { optionalAuth } from "../middleware/optionalAuth.js";
import { commentLimiter } from "../middleware/rateLimit.js";

const router = express.Router();

// ⚠️ FIX: commentLimiter artık burada, sadece yorum GÖNDERME (POST) isteğine
// uygulanıyor — eskiden app.js'te tüm /api/comments route'larının önüne
// (GET dahil) konulmuştu, bkz. rateLimit.js'teki commentLimiter yorumu.
// optionalAuth: giriş yapmış kullanıcının engellediği kişilerin yorumları gizlenir
router.get("/:id", optionalAuth, getComment);
router.post("/", protect, commentLimiter, postComment);
router.delete("/:id", protect, deleteComment);

export default router;
