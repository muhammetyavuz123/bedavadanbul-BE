import express from "express";
import { verifyToken } from "../middleware/verifyToken.js";
import {
  addPost,
  deletePost,
  getPost,
  getPosts,
  updatePost,
  confirmPost,
} from "../controllers/post.controller.js";

const router = express.Router();

// 1️⃣ Herkes görebilir: tüm postlar / query parametre ile filtrelenebilir
router.get("/", getPosts);

// 2️⃣ Login olan kullanıcı: sadece kendi postları
router.get("/me", verifyToken, async (req, res) => {
  try {
    // verifyToken ile req.user geldiğini varsayıyoruz
    req.query.userId = req.user.id;
    await getPosts(req, res); // aynı controller kullanılıyor
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to get your posts" });
  }
});

// Diğer işlemler (add, update, delete, approve) login gerekli
router.get("/:id", getPost);
router.post("/", verifyToken, addPost);
router.put("/:id", verifyToken, updatePost);
router.delete("/:id", verifyToken, deletePost);
router.put("/:id/approve", verifyToken, confirmPost);

export default router;
