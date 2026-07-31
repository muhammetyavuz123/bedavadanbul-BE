import prisma from "../lib/prisma.js";

// Yorum oluştur
export const postComment = async (req, res) => {
  const { content, postId } = req.body;
  // ⚠️ userId ASLA client'tan alınmamalı; her zaman `protect` middleware'inin
  // doğruladığı oturumdan (req.user) geliyor olmalı. Aksi halde bir kullanıcı
  // başka biri adına yorum yazabilir.
  const userId = req.user.id;

  if (!content || !postId) {
    return res.status(400).json({ message: "Eksik bilgi" });
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

  try {
    const comments = await prisma.comment.findMany({
      where: { postId },
      include: {
        user: {
          select: { id: true, username: true, avatar: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });
    res.json(comments);
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

    if (comment.userId !== userId) {
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
