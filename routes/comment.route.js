import express from "express";
import {
  getComment,
  postComment,
  deleteComment,
} from "../controllers/comments.controller.js";
import { verifyToken } from "../middleware/verifyToken.js";

const router = express.Router();

router.get("/:id", getComment);
router.post("/", verifyToken, postComment);
router.delete("/:id", verifyToken, deleteComment);

export default router;
