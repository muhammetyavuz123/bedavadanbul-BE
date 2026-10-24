import prisma from "../lib/prisma.js";
import { isClean } from "../utils/filter.js";
import { blockedIdsFor } from "../utils/blocks.js";

const OID = /^[a-f\d]{24}$/i;
const MAX_COMMENT = 500;

// Yorum oluştur
export const postComment = async (req, res) => {
  const postId = req.body?.postId;
  const content = typeof req.body?.content === "string" ? req.body.content.trim() : "";
  // ⚠️ userId ASLA client'tan alınmamalı; her zaman `protect` middleware'inin
  // doğruladığı oturumdan (req.user) geliyor olmalı. Aksi halde bir kullanıcı
  // başka biri adına yorum yazabilir.
  const userId = req.user.id;

  if (!content || !postId) {
    return res.status(400).json({ message: "Eksik bilgi" });
  }
  if (typeof postId !== "string" || !OID.test(postId)) {
    return res.status(400).json({ message: "Geçersiz kampanya" });
  }
  if (content.length > MAX_COMMENT) {
    return res.status(400).json({ message: `Yorum en fazla ${MAX_COMMENT} karakter olabilir.` });
  }
  if (!isClean(content)) {
    return res.status(400).json({ message: "Uygunsuz içerik tespit edildi." });
  }

  try {
    const newComment = await prisma.comment.create({
      data: {
        content,
        post: { connect: { id: postId } },
        user: { connect: { id: userId } },
      },
    });
    res.status(201).json(newComment);
  } catch (err) {
    console.error("Yorum oluşturulamadı:", err);
    res.status(500).json({ message: "Yorum oluşturulamadı" });
  }
};

// Post'a ait yorumları getir
export const getComment = async (req, res) => {
  const { id: postId } = req.params;
  if (!OID.test(postId)) return res.json([]);

  try {
    // Giriş yapmış kullanıcının engellediği kişilerin yorumları gösterilmez
    const blocked = await blockedIdsFor(req.user?.id);
    const comments = await prisma.comment.findMany({
      where: {
        postId,
        ...(blocked.length ? { userId: { notIn: blocked } } : {}),
      },
      include: {
        user: {
          select: { id: true, username: true, avatar: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    // Bu kampanyayı kullandığını belirtmiş yorumcular için rozet
    const redeemed = comments.length
      ? await prisma.campaignRedemption.findMany({
          where: { postId, userId: { in: comments.map((c) => c.userId) } },
          select: { userId: true },
        })
      : [];
    const usedSet = new Set(redeemed.map((r) => r.userId));
    res.json(comments.map((c) => ({ ...c, usedCampaign: usedSet.has(c.userId) })));
  } catch (err) {
    console.error("Yorumlar getirilemedi:", err);
    res.status(500).json({ message: "Yorumlar getirilemedi" });
  }
};
export const deleteComment = async (req, res) => {
  const commentId = req.params.id;
  // Bu route zaten `protect` middleware'inden geçiyor, dolayısıyla req.user
  // burada garanti dolu. Ayrıca cookie'den manuel token okumaya/doğrulamaya
  // gerek yok; bu hem gereksiz kod tekrarıydı hem de cookie üretimde
  // gönderilmediğinde (cross-domain) yanlışlıkla 401 dönmesine yol açıyordu.
  const userId = req.user.id;

  try {
    const comment = await prisma.comment.findUnique({
      where: { id: commentId },
    });

    if (!comment) {
      return res.status(404).json({ message: "Yorum bulunamadı." });
    }

    // Yazan kişi ya da yönetici silebilir
    if (comment.userId !== userId && req.user.role !== "admin") {
      return res.status(403).json({ message: "Bu yorumu silme yetkiniz yok." });
    }

    await prisma.comment.delete({
      where: { id: commentId },
    });

    res.status(200).json({ message: "Yorum silindi." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Yorum silinirken hata oluştu." });
  }
};
