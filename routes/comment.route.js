import express from "express";
import {
  getComment,
  postComment,
  deleteComment,
} from "../controllers/comments.controller.js";
import { protect } from "../middleware/protect.js";

const router = express.Router();

router.get("/:id", getComment);
router.post("/", protect, postComment);
router.delete("/:id", protect, deleteComment);

export default router;
