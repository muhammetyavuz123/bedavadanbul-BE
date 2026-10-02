import express from "express";
import { protect } from "../middleware/protect.js";
import { isAdmin } from "../middleware/isAdmin.js";
import {
  inquiryLimiter,
  inquiryMessageLimiter,
  reviewLimiter,
  favoriteLimiter,
  replyLimiter,
  trackLimiter,
} from "../middleware/rateLimit.js";
import {
  listBusinesses,
  getBusiness,
  getMyBusiness,
  saveMyBusiness,
  listReviews,
  getMyReview,
  upsertReview,
  deleteReview,
  createInquiry,
  listReceivedInquiries,
  listSentInquiries,
  getInquiry,
  addInquiryMessage,
  closeInquiry,
  replyToReview,
  deleteReviewReply,
  getFavoriteState,
  addFavorite,
  removeFavorite,
  listMyFavorites,
  listBusinessPosts,
  trackEvent,
  getMyStats,
  getPlaces,
  adminListBusinesses,
  adminUpdateBusiness,
} from "../controllers/business.controller.js";

const router = express.Router();

// ⚠️ Sıralama önemli: "/me", "/inquiries/..." gibi sabit
// yollar, "/:id" gibi dinamik yollardan ÖNCE tanımlanmalı.
router.get("/", listBusinesses);
router.get("/places", getPlaces);

// Yönetici: rozet / öne çıkarma / yayından kaldırma
router.get("/admin/all", protect, isAdmin, adminListBusinesses);
router.patch("/admin/:id", protect, isAdmin, adminUpdateBusiness);

// Favori işletmelerim
router.get("/favorites/mine", protect, listMyFavorites);

// Kendi işletme profilim (işyeri hesapları)
router.get("/me", protect, getMyBusiness);
router.put("/me", protect, saveMyBusiness);
router.get("/me/inquiries", protect, listReceivedInquiries);
router.get("/me/stats", protect, getMyStats);

// Özel soru-cevap (sadece konuşmanın iki tarafı görebilir)
router.get("/inquiries/mine", protect, listSentInquiries);
router.get("/inquiries/:inquiryId", protect, getInquiry);
router.post(
  "/inquiries/:inquiryId/messages",
  protect,
  inquiryMessageLimiter,
  addInquiryMessage,
);
router.patch("/inquiries/:inquiryId/close", protect, closeInquiry);

// Herkese açık işletme sayfası + yorumlar
router.get("/:id", getBusiness);
router.get("/:id/reviews", listReviews);
router.get("/:id/reviews/mine", protect, getMyReview);
router.post("/:id/reviews", protect, reviewLimiter, upsertReview);
router.delete("/:id/reviews/:reviewId", protect, deleteReview);
router.put("/:id/reviews/:reviewId/reply", protect, replyLimiter, replyToReview);
router.delete("/:id/reviews/:reviewId/reply", protect, deleteReviewReply);
router.post("/:id/inquiries", protect, inquiryLimiter, createInquiry);

// Favori, kampanyalar, sayaç
router.get("/:id/favorite", protect, getFavoriteState);
router.post("/:id/favorite", protect, favoriteLimiter, addFavorite);
router.delete("/:id/favorite", protect, favoriteLimiter, removeFavorite);
router.get("/:id/posts", listBusinessPosts);
router.post("/:id/track", trackLimiter, trackEvent);

export default router;
