import prisma from "../lib/prisma.js";
import { isExpoToken, sendToTokens } from "../utils/push.js";
import { notifyUsers } from "../utils/notify.js";

const MAX_TOKENS_PER_USER = 10;
const ROLES = ["user", "business"];
// Mobil uygulamada bildirime dokununca açılabilecek ekranlar
const SCREENS = ["home", "campaigns", "businesses"];
const KEEP_DAYS = 60;

const text = (v) => (typeof v === "string" ? v.trim() : "");
const isObjectId = (v) => typeof v === "string" && /^[a-f\d]{24}$/i.test(v);

// ====================== KULLANICI: BİLDİRİM KUTUSU ======================
export const listMine = async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 50);

    const [data, total, unread] = await Promise.all([
      prisma.userNotification.findMany({
        where: { userId: req.user.id },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.userNotification.count({ where: { userId: req.user.id } }),
      prisma.userNotification.count({ where: { userId: req.user.id, readAt: null } }),
    ]);

    // Eski bildirimleri arka planda temizle
    prisma.userNotification
      .deleteMany({
        where: {
          userId: req.user.id,
          createdAt: { lt: new Date(Date.now() - KEEP_DAYS * 86400 * 1000) },
        },
      })
      .catch(() => {});

    res.json({ data, total, unread, page, limit });
  } catch (err) {
    console.error("listMine hatası:", err);
    res.status(500).json({ message: "Bildirimler alınamadı" });
  }
};

export const unreadCount = async (req, res) => {
  try {
    const unread = await prisma.userNotification.count({
      where: { userId: req.user.id, readAt: null },
    });
    res.json({ unread });
  } catch (err) {
    console.error("unreadCount hatası:", err);
    res.status(500).json({ message: "Sayı alınamadı" });
  }
};

export const markAllRead = async (req, res) => {
  try {
    await prisma.userNotification.updateMany({
      where: { userId: req.user.id, readAt: null },
      data: { readAt: new Date() },
    });
    res.status(204).end();
  } catch (err) {
    console.error("markAllRead hatası:", err);
    res.status(500).json({ message: "İşlem yapılamadı" });
  }
};

export const markRead = async (req, res) => {
  if (!isObjectId(req.params.id)) return res.status(404).json({ message: "Bulunamadı" });
  try {
    await prisma.userNotification.updateMany({
      where: { id: req.params.id, userId: req.user.id, readAt: null },
      data: { readAt: new Date() },
    });
    res.status(204).end();
  } catch (err) {
    console.error("markRead hatası:", err);
    res.status(500).json({ message: "İşlem yapılamadı" });
  }
};

export const removeOne = async (req, res) => {
  if (!isObjectId(req.params.id)) return res.status(404).json({ message: "Bulunamadı" });
  try {
    await prisma.userNotification.deleteMany({
      where: { id: req.params.id, userId: req.user.id },
    });
    res.status(204).end();
  } catch (err) {
    console.error("removeOne hatası:", err);
    res.status(500).json({ message: "Silinemedi" });
  }
};

// ====================== CİHAZ KAYDI (ileride telefon bildirimi için) ======================
export const registerDevice = async (req, res) => {
  const token = text(req.body?.token);
  const platform = ["ios", "android"].includes(req.body?.platform) ? req.body.platform : null;
  if (!isExpoToken(token)) {
    return res.status(400).json({ message: "Geçersiz bildirim anahtarı." });
  }
  try {
    await prisma.pushToken.upsert({
      where: { token },
      create: { token, platform, user: { connect: { id: req.user.id } } },
      update: { platform, user: { connect: { id: req.user.id } } },
    });
    const mine = await prisma.pushToken.findMany({
      where: { userId: req.user.id },
      orderBy: { updatedAt: "desc" },
      select: { id: true },
    });
    if (mine.length > MAX_TOKENS_PER_USER) {
      await prisma.pushToken.deleteMany({
        where: { id: { in: mine.slice(MAX_TOKENS_PER_USER).map((m) => m.id) } },
      });
    }
    res.status(204).end();
  } catch (err) {
    console.error("registerDevice hatası:", err);
    res.status(500).json({ message: "Cihaz kaydedilemedi" });
  }
};

export const unregisterDevice = async (req, res) => {
  const token = text(req.body?.token);
  try {
    if (token) await prisma.pushToken.deleteMany({ where: { token, userId: req.user.id } });
    res.status(204).end();
  } catch (err) {
    console.error("unregisterDevice hatası:", err);
    res.status(500).json({ message: "İşlem yapılamadı" });
  }
};

// ====================== YÖNETİCİ: TOPLU BİLDİRİM ======================
const audienceUserWhere = (audience, adminId) => {
  const type = text(audience?.type);
  if (type === "me") return { id: adminId };
  if (type === "all") return {};
  if (type === "role") {
    const role = text(audience?.role);
    return ROLES.includes(role) ? { role } : null;
  }
  if (type === "city") {
    const city = text(audience?.city);
    const district = text(audience?.district);
    if (!city) return null;
    return { city, ...(district ? { district } : {}) };
  }
  return null;
};

const audienceLabel = (audience) => {
  const type = text(audience?.type);
  if (type === "me") return "Sadece ben (test)";
  if (type === "all") return "Tüm kullanıcılar";
  if (type === "role")
    return text(audience?.role) === "business" ? "İşletme sahipleri" : "Bireysel kullanıcılar";
  if (type === "city") {
    const d = text(audience?.district);
    return d ? `${text(audience?.city)} / ${d}` : text(audience?.city);
  }
  return "-";
};

const loadAudience = async (audience, adminId) => {
  const where = audienceUserWhere(audience, adminId);
  if (where === null) return null;
  const users = await prisma.user.findMany({ where, select: { id: true } });
  const ids = users.map((u) => u.id);
  const devices = ids.length
    ? await prisma.pushToken.count({ where: { userId: { in: ids } } })
    : 0;
  return { ids, devices };
};

export const adminPreview = async (req, res) => {
  try {
    const found = await loadAudience(req.body?.audience, req.user.id);
    if (!found) return res.status(400).json({ message: "Geçersiz hedef kitle." });
    res.json({ users: found.ids.length, devices: found.devices });
  } catch (err) {
    console.error("adminPreview hatası:", err);
    res.status(500).json({ message: "Önizleme alınamadı" });
  }
};

export const adminSend = async (req, res) => {
  const title = text(req.body?.title);
  const body = text(req.body?.body);
  const screen = text(req.body?.screen);

  if (title.length < 2 || title.length > 65) {
    return res.status(400).json({ message: "Başlık 2-65 karakter olmalı." });
  }
  if (body.length < 2 || body.length > 240) {
    return res.status(400).json({ message: "Mesaj 2-240 karakter olmalı." });
  }
  if (screen && !SCREENS.includes(screen)) {
    return res.status(400).json({ message: "Geçersiz hedef ekran." });
  }

  try {
    const found = await loadAudience(req.body?.audience, req.user.id);
    if (!found) return res.status(400).json({ message: "Geçersiz hedef kitle." });
    if (found.ids.length === 0) {
      return res.status(400).json({ message: "Bu hedef kitlede kullanıcı yok." });
    }

    await notifyUsers(found.ids, {
      title,
      body,
      kind: "broadcast",
      screen: screen || null,
    });

    const record = await prisma.pushBroadcast.create({
      data: {
        title,
        body,
        audience: audienceLabel(req.body?.audience),
        recipients: found.ids.length,
        adminId: req.user.id,
      },
    });
    res.status(201).json(record);
  } catch (err) {
    console.error("adminSend hatası:", err);
    res.status(500).json({ message: "Bildirim gönderilemedi" });
  }
};

export const adminHistory = async (req, res) => {
  try {
    const data = await prisma.pushBroadcast.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    res.json({ data });
  } catch (err) {
    console.error("adminHistory hatası:", err);
    res.status(500).json({ message: "Geçmiş alınamadı" });
  }
};
