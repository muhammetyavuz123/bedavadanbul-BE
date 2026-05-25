import express from "express";
import { addMessage } from "../controllers/message.controller.js";
import { protect } from "../middleware/protect.js";

const router = express.Router();

router.post("/:chatId", protect, addMessage);

export default router;
