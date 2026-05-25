import express from "express";
import {
  shouldBeAdmin,
  shouldBeLoggedIn,
} from "../controllers/test.controller.js";
import { protect } from "../middleware/protect.js";

const router = express.Router();

router.get("/should-be-logged-in", protect, shouldBeLoggedIn);

router.get("/should-be-admin", protect, shouldBeAdmin);

export default router;
