import { Request, Response } from "express";
import path from 'path'
import { PDFParser } from "../services";

export const SendHTML = (_: Request, res: Response) => {
  res.sendFile(path.resolve(`${__dirname}/../index.html`));
};

export const ProcessPDF = async (req: Request, res: Response) => {
  const file = req.file;
  const mimeTypes = ["application/pdf"];

  const mimeType = mimeTypes.find((mT) => mT === req.file.mimetype);

  console.log(mimeType);

  if (req.file && !mimeType) {
    res.writeHead(400, { "Content-Type": "text/plain" });
    return res.json({ message: "Only images allowed!" });
  } else {
    try {
      const pdfParser = new PDFParser();
      const response = await pdfParser.parseFile(file.buffer)
      res.json(response)
     
    } catch (error) {
      console.log(error)
      res.status(500).end("Server Error");
    }
  }
};