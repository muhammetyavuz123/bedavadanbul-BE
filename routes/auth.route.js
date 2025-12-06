import express from "express";
import rateLimit from "express-rate-limit";

import {
  login,
  logout,
  register,
  forgotPassword,
  resetPassword,
} from "../controllers/auth.controller.js";

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 5,
  message: "Çok fazla giriş denemesi yaptınız. 10 dakika sonra deneyin.",
});

// REGISTER LIMIT
const registerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: "Çok fazla kayıt denemesi yaptınız.",
});

router.post("/register", registerLimiter, register);
router.post("/login", loginLimiter, login);
router.post("/logout", logout);
router.post("/forgot-password", forgotPassword);
router.post("/reset-password", resetPassword);

export default router;
