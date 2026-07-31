import express from "express";
import { protect } from "../middleware/protect.js";
import { isAdmin } from "../middleware/isAdmin.js";
import {
  addPost,
  deletePost,
  getPost,
  getPosts,
  updatePost,
  approvePost,
} from "../controllers/post.controller.js";

const router = express.Router();

// 1️⃣ Herkes görebilir: tüm postlar / query parametre ile filtrelenebilir
router.get("/", getPosts);

// 2️⃣ Login olan kullanıcı: sadece kendi postları
router.get("/me", protect, async (req, res) => {
  try {
    // protect ile req.user geldiğini varsayıyoruz
    req.query.userId = req.user.id;
    await getPosts(req, res); // aynı controller kullanılıyor
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to get your posts" });
  }
});

// Diğer işlemler (add, update, delete, approve) login gerekli
router.get("/:id", getPost);
router.post("/", protect, addPost);
router.put("/:id", protect, updatePost);
router.delete("/:id", protect, deletePost);
// İlan onaylama sadece adminlere açık olmalı
router.put("/:id/approve", protect, isAdmin, approvePost);
export default router;
