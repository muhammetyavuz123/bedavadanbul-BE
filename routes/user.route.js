import express from "express";
import {
  deleteUser,
  getUser,
  getUsers,
  updateUser,
  savePost,
  profilePosts,
  getNotificationNumber,
} from "../controllers/user.controller.js";
import { protect } from "../middleware/protect.js";

const router = express.Router();

router.get("/", getUsers);
// router.get("/search/:id", protect, getUser);
router.put("/:id", protect, updateUser);
router.delete("/:id", protect, deleteUser);
router.post("/save", protect, savePost);
router.get("/profilePosts", protect, profilePosts);
router.get("/notification", protect, getNotificationNumber);

export default router;
