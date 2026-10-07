import express from "express";
import rateLimit from "express-rate-limit";
import { protect } from "../middleware/protect.js";
import {
  login,
  logout,
  register,
  forgotPassword,
  resetPassword,
  deleteAccount,
} from "../controllers/auth.controller.js";

const router = express.Router();

// LOGIN LIMIT
// ⚠️ FIX: Eskiden BAŞARILI girişler de sayılıyordu (5 giriş / 10 dk), bu yüzden
// aynı ağdan (ev/ofis/mobil operatör) birkaç kişi ya da birkaç hesap deneyen
// biri hızla 429 alıyordu. Artık yalnızca BAŞARISIZ (yanlış şifre) denemeler
// sayılıyor; kaba kuvvet (brute force) koruması aynen sürüyor. Yanıt JSON
// olduğu için istemciler mesajı gösterebiliyor.
const loginLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 10,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Çok fazla hatalı giriş denemesi yaptınız. 10 dakika sonra tekrar deneyin." },
});

// REGISTER LIMIT
// ⚠️ FIX: Eskiden her istek (eksik alan, "bu e-posta zaten kayıtlı" gibi
// başarısız denemeler dahil) 15 dakikada 5 hakkın içinden sayılıyordu; 3-4
// denemede 429 geliyordu. Artık:
//  1) Tüm denemeler için geniş bir tavan (bcrypt maliyeti / spam koruması),
//  2) Yalnızca BAŞARILI kayıtlar için IP başına saatlik sınır (ortak IP'li
//     operatör ağlarında birkaç gerçek kullanıcıya yetecek kadar yüksek).
const registerAttemptLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Çok fazla kayıt denemesi yaptınız. Biraz sonra tekrar deneyin." },
});

const registerSuccessLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 15,
  skipFailedRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Bu bağlantıdan çok fazla hesap oluşturuldu. Bir saat sonra tekrar deneyin." },
});

router.post("/register", registerAttemptLimiter, registerSuccessLimiter, register);
router.post("/login", loginLimiter, login);
router.post("/logout", logout);
router.post("/forgot-password", forgotPassword);
router.post("/reset-password", resetPassword);
router.delete("/users/me", protect, deleteAccount);
export default router;
