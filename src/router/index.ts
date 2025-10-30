import path from "path";
import multer from "multer";
import { Router } from "express";
import { ProcessPDF, SendHTML } from "../controller";


const upload = multer({ storage: multer.memoryStorage() });
const router = Router()

router.get("/", SendHTML);

router.post(
  "/upload",
  upload.single("project"),
  ProcessPDF
);


export default router;