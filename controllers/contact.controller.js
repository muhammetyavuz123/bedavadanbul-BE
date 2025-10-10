import express from "express";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export const postContact = async (req, res) => {
  const { name, email, phone, message } = req.body;

  if (!name || !email || !message || !phone) {
    return res.status(400).json({ message: "Tüm alanlar zorunludur." });
  }

  try {
    const newMessage = await prisma.contactMessage.create({
      data: { name, email, message, phone },
    });

    res
      .status(201)
      .json({ message: "Mesajınız başarıyla gönderildi.", data: newMessage });
  } catch (err) {
    console.error("Mesaj kaydedilemedi:", err);
    res.status(500).json({ message: "Sunucu hatası." });
  }
};

export const getContacts = async (req, res) => {
  try {
    const messages = await prisma.contactMessage.findMany({
      orderBy: { createdAt: "desc" }, // en yeniler önce gelsin
    });

    res.status(200).json(messages);
  } catch (err) {
    console.error("Mesajlar getirilemedi:", err);
    res.status(500).json({ message: "Mesajlar alınamadı" });
  }
};
