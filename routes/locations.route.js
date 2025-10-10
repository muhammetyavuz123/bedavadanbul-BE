import express from "express";
import { verifyToken } from "../middleware/verifyToken.js";
import {
  getCities,
  getDistrich,
} from "../controllers/locationRoutes.controller.js";

const router = express.Router();

router.get("/", getCities);
router.get("/:ilAdi", getDistrich);

export default router;
