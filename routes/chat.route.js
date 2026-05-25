import express from "express";
import {
  getChats,
  getChat,
  addChat,
  readChat,
} from "../controllers/chat.controller.js";
import { protect } from "../middleware/protect.js";

const router = express.Router();

router.get("/", protect, getChats);
router.get("/:id", protect, getChat);
router.post("/", protect, addChat);
router.put("/read/:id", protect, readChat);

export default router;
