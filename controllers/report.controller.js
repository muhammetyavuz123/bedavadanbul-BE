import prisma from "../lib/prisma.js";
import { notifyUsers, previewText } from "../utils/notify.js";

const OID = /^[a-f\d]{24}$/i;
const isObjectId = (v) => typeof v === "string" && OID.test(v);
const text = (v) => (typeof v === "string" ? v.trim() : "");

// Şikâyet edilebilen içerik türleri
const TARGET_TYPES = ["review", "comment", "business", "user"];

// Şikâyet nedenleri (istemci bu kodları gönderir)
const REASONS = {
  spam: "Spam / reklam",
  abuse: "Hakaret veya taciz",
  hate: "Nefret söylemi",
  fake: "Sahte veya yanıltıcı",
  inappropriate: "Uygunsuz içerik",
  other: "Diğer",
};

// Her yorum silindiğinde işletme puanı yeniden hesaplanır
// (business.controller.js'teki ile aynı mantık).
const recomputeRating = async (businessId) => {
  const agg = await prisma.businessReview.aggregate({
    where: { businessId },
    _avg: { rating: true },
    _count: { _all: true },
  });
  await prisma.business.update({
    where: { id: businessId },
    data: {
      ratingAvg: Math.round((agg._avg.rating || 0) * 10) / 10,
      ratingCount: agg._count._all,
    },
  });
};

// Şikâyet edilen içeriğin sahibini bulur. İçerik yoksa null döner.
async function resolveTarget(type, id) {
  if (type === "review") {
    const r = await prisma.businessReview.findUnique({
      where: { id },
      select: { userId: true },
    });
    return r ? { userId: r.userId } : null;
  }
  if (type === "comment") {
    const c = await prisma.comment.findUnique({ where: { id }, select: { userId: true } });
    return c ? { userId: c.userId } : null;
  }
  if (type === "business") {
    const b = await prisma.business.findUnique({ where: { id }, select: { ownerId: true } });
    return b ? { userId: b.ownerId } : null;
  }
  if (type === "user") {
    const u = await prisma.user.findUnique({ where: { id }, select: { id: true } });
    return u ? { userId: u.id } : null;
  }
  return null;
}

// ====================== ŞİKÂYET ======================

// POST /api/reports  { targetType, targetId, reason, details? }
export const createReport = async (req, res) => {
  const targetType = text(req.body?.targetType);
  const targetId = text(req.body?.targetId);
  const reason = text(req.body?.reason);
  const details = text(req.body?.details);

  if (!TARGET_TYPES.includes(targetType) || !isObjectId(targetId)) {
    return res.status(400).json({ message: "Geçersiz şikâyet bilgisi." });
  }
  if (!REASONS[reason]) {
    return res.status(400).json({ message: "Lütfen bir neden seçin." });
  }
  if (details.length > 300) {
    return res.status(400).json({ message: "Açıklama en fazla 300 karakter olabilir." });
  }

  try {
    const target = await resolveTarget(targetType, targetId);
    if (!target) return res.status(404).json({ message: "İçerik bulunamadı." });

    if (target.userId === req.user.id) {
      return res.status(400).json({ message: "Kendi içeriğinizi şikâyet edemezsiniz." });
    }

    try {
      await prisma.report.create({
        data: {
          reporter: { connect: { id: req.user.id } },
          targetType,
          targetId,
          reportedUserId: target.userId,
          reason,
          details: details || null,
        },
      });
    } catch (err) {
      // Aynı kullanıcı aynı içeriği zaten bildirmiş (benzersiz kısıt)
      if (err?.code === "P2002") {
        return res.json({ message: "Bu içeriği zaten bildirdiniz.", duplicate: true });
      }
      throw err;
    }

    // Yöneticilere haber ver (beklemez, hata fırlatmaz)
    prisma.user
      .findMany({ where: { role: "admin" }, select: { id: true } })
      .then((admins) =>
        notifyUsers(
          admins.map((a) => a.id),
          {
            title: "Yeni şikâyet",
            body: `${REASONS[reason]} • ${targetType}`,
            kind: "general",
          },
        ),
      )
      .catch((err) => console.error("Şikâyet bildirimi gönderilemedi:", err));

    res.status(201).json({
      message: "Bildiriminiz alındı. En kısa sürede inceleyeceğiz, teşekkürler.",
    });
  } catch (err) {
    console.error("createReport hatası:", err);
    res.status(500).json({ message: "Şikâyet gönderilemedi" });
  }
};

// ====================== ENGELLEME ======================

// GET /api/reports/blocks — engellediğim kişiler
export const listBlocks = async (req, res) => {
  try {
    const rows = await prisma.userBlock.findMany({
      where: { blockerId: req.user.id },
      orderBy: { createdAt: "desc" },
      include: { blocked: { select: { id: true, username: true, avatar: true } } },
    });
    res.json({ data: rows.map((r) => ({ ...r.blocked, blockedAt: r.createdAt })) });
  } catch (err) {
    console.error("listBlocks hatası:", err);
    res.status(500).json({ message: "Engellenenler alınamadı" });
  }
};

// POST /api/reports/blocks/:userId
export const blockUser = async (req, res) => {
  const { userId } = req.params;
  if (!isObjectId(userId)) return res.status(404).json({ message: "Kullanıcı bulunamadı" });
  if (userId === req.user.id) {
    return res.status(400).json({ message: "Kendinizi engelleyemezsiniz." });
  }

  try {
    const target = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!target) return res.status(404).json({ message: "Kullanıcı bulunamadı" });

    await prisma.userBlock.upsert({
      where: { blockerId_blockedId: { blockerId: req.user.id, blockedId: userId } },
      create: {
        blocker: { connect: { id: req.user.id } },
        blocked: { connect: { id: userId } },
      },
      update: {},
    });
    res.status(201).json({ message: "Kullanıcı engellendi. Yorumları artık size gösterilmeyecek." });
  } catch (err) {
    console.error("blockUser hatası:", err);
    res.status(500).json({ message: "Kullanıcı engellenemedi" });
  }
};

// DELETE /api/reports/blocks/:userId
export const unblockUser = async (req, res) => {
  const { userId } = req.params;
  if (!isObjectId(userId)) return res.status(404).json({ message: "Kullanıcı bulunamadı" });

  try {
    await prisma.userBlock.deleteMany({
      where: { blockerId: req.user.id, blockedId: userId },
    });
    res.json({ message: "Engel kaldırıldı." });
  } catch (err) {
    console.error("unblockUser hatası:", err);
    res.status(500).json({ message: "Engel kaldırılamadı" });
  }
};

// ====================== YÖNETİCİ ======================

// Şikâyet kartında gösterilecek kısa içerik özeti
async function buildPreview(report) {
  try {
    if (report.targetType === "review") {
      const r = await prisma.businessReview.findUnique({
        where: { id: report.targetId },
        select: { rating: true, comment: true, business: { select: { id: true, name: true } } },
      });
      if (!r) return null;
      return {
        text: r.comment || "(yalnızca puan)",
        extra: `${r.rating}/5 • ${r.business?.name || ""}`,
        businessId: r.business?.id || null,
      };
    }
    if (report.targetType === "comment") {
      const c = await prisma.comment.findUnique({
        where: { id: report.targetId },
        select: { content: true, postId: true },
      });
      return c ? { text: c.content, extra: "Kampanya yorumu", postId: c.postId } : null;
    }
    if (report.targetType === "business") {
      const b = await prisma.business.findUnique({
        where: { id: report.targetId },
        select: { id: true, name: true, description: true },
      });
      return b
        ? { text: b.description || b.name, extra: b.name, businessId: b.id }
        : null;
    }
    if (report.targetType === "user") {
      const u = await prisma.user.findUnique({
        where: { id: report.targetId },
        select: { username: true },
      });
      return u ? { text: u.username, extra: "Kullanıcı" } : null;
    }
  } catch (err) {
    console.error("buildPreview hatası:", err);
  }
  return null;
}

// GET /api/reports/admin/all?status=open|resolved|dismissed|all&page=1&limit=20
export const adminListReports = async (req, res) => {
  const status = text(req.query.status) || "open";
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));

  const where = status === "all" ? {} : { status };

  try {
    const [rows, total, openCount] = await Promise.all([
      prisma.report.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        include: { reporter: { select: { id: true, username: true } } },
      }),
      prisma.report.count({ where }),
      prisma.report.count({ where: { status: "open" } }),
    ]);

    const userIds = [...new Set(rows.map((r) => r.reportedUserId).filter(Boolean))];
    const users = userIds.length
      ? await prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, username: true },
        })
      : [];
    const userMap = Object.fromEntries(users.map((u) => [u.id, u]));

    const data = await Promise.all(
      rows.map(async (r) => ({
        ...r,
        reasonLabel: REASONS[r.reason] || r.reason,
        reportedUser: r.reportedUserId ? userMap[r.reportedUserId] || null : null,
        preview: await buildPreview(r),
      })),
    );

    res.json({ data, total, page, limit, open: openCount });
  } catch (err) {
    console.error("adminListReports hatası:", err);
    res.status(500).json({ message: "Şikâyetler alınamadı" });
  }
};

// POST /api/reports/admin/:id/resolve  { action: "remove" | "resolve" | "dismiss", note? }
//  - remove : içeriği kaldırır (yorum/kampanya yorumu silinir, işletme yayından kalkar)
//  - resolve: içerik kaldırılmadan "ilgilenildi" olarak kapatır
//  - dismiss: şikâyet yersiz bulundu
export const adminResolveReport = async (req, res) => {
  const { id } = req.params;
  if (!isObjectId(id)) return res.status(404).json({ message: "Şikâyet bulunamadı" });

  const action = text(req.body?.action);
  const note = text(req.body?.note).slice(0, 300);
  if (!["remove", "resolve", "dismiss"].includes(action)) {
    return res.status(400).json({ message: "Geçersiz işlem." });
  }

  try {
    const report = await prisma.report.findUnique({ where: { id } });
    if (!report) return res.status(404).json({ message: "Şikâyet bulunamadı" });

    if (action === "remove") {
      if (report.targetType === "review") {
        const r = await prisma.businessReview.findUnique({
          where: { id: report.targetId },
          select: { businessId: true },
        });
        if (r) {
          await prisma.businessReview.delete({ where: { id: report.targetId } });
          await recomputeRating(r.businessId);
        }
      } else if (report.targetType === "comment") {
        await prisma.comment.deleteMany({ where: { id: report.targetId } });
      } else if (report.targetType === "business") {
        await prisma.business.updateMany({
          where: { id: report.targetId },
          data: { isActive: false },
        });
      } else {
        return res.status(400).json({
          message: "Kullanıcı şikâyetinde içerik kaldırılamaz. 'Çözüldü' olarak kapatın.",
        });
      }
    }

    const newStatus = action === "dismiss" ? "dismissed" : "resolved";
    const decidedAt = new Date();

    // Aynı içeriğe gelen diğer açık şikâyetleri de aynı kararla kapat
    await prisma.report.updateMany({
      where: {
        status: "open",
        targetType: report.targetType,
        targetId: report.targetId,
      },
      data: { status: newStatus, adminNote: note || null, decidedAt },
    });
    await prisma.report.update({
      where: { id },
      data: { status: newStatus, adminNote: note || null, decidedAt },
    });

    // Şikâyet edene geri bildirim (beklemez)
    notifyUsers([report.reporterId], {
      title: "Bildiriminiz incelendi",
      body:
        action === "dismiss"
          ? "Şikâyetinizi inceledik, içerikte bir sorun tespit etmedik. Teşekkürler."
          : "Şikâyetiniz üzerine gerekli işlem yapıldı. Teşekkürler.",
      kind: "general",
    }).catch(() => {});

    res.json({ message: "Şikâyet kapatıldı.", status: newStatus });
  } catch (err) {
    console.error("adminResolveReport hatası:", err);
    res.status(500).json({ message: "İşlem yapılamadı" });
  }
};
