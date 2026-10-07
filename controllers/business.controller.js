import prisma from "../lib/prisma.js";
import { isClean } from "../utils/filter.js";
import { notifyUsers, previewText } from "../utils/notify.js";
import {
  findUsableCategory,
  isValidLocation,
  statusOf,
  notifyAdminsOfApplication,
  notifyApplicant,
} from "../utils/application.js";
import {
  notifyOwnerNewInquiry,
  notifyOwnerNewMessage,
  notifyCustomerReply,
  notifyOwnerNewReview,
  notifyReviewerReply,
} from "../utils/mailer.js";

const MAX_OPEN_INQUIRIES_PER_BUSINESS = 3;
// Fotoğraf sayısı pratikte sınırsız; yalnızca kötüye kullanımı önleyen yüksek bir üst sınır.
const MAX_PHOTOS = 40;

// ---------- yardımcılar ----------
const isObjectId = (v) => typeof v === "string" && /^[a-f\d]{24}$/i.test(v);
const text = (v) => (typeof v === "string" ? v.trim() : "");
const toPage = (v) => Math.max(parseInt(v, 10) || 1, 1);
const toLimit = (v, def = 12) => Math.min(Math.max(parseInt(v, 10) || def, 1), 50);

const canManageBusiness = (user) =>
  user && (user.role === "business" || user.role === "admin");

// Link olarak render edildiği için sadece http/https kabul ediyoruz
// (javascript: gibi şemalar engellenir). Geçersizse undefined döner.
const normalizeWebsite = (raw) => {
  const v = text(raw);
  if (!v) return null;
  const withProtocol = /^https?:\/\//i.test(v) ? v : `https://${v}`;
  try {
    const url = new URL(withProtocol);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
};

// Görseller sadece projenin Cloudinary hesabından kabul edilir.
const isCloudinaryUrl = (v) =>
  typeof v === "string" && /^https:\/\/res\.cloudinary\.com\//.test(v);

// Müşteri güveni için toplu yanıt istatistiği (kimlik/konu içermez).
const getResponseStats = async (ownerId) => {
  const inquiries = await prisma.inquiry.findMany({
    where: { ownerId },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      createdAt: true,
      messages: {
        where: { senderId: ownerId },
        orderBy: { createdAt: "asc" },
        take: 1,
        select: { createdAt: true },
      },
    },
  });
  if (inquiries.length < 3) return null;

  const answered = inquiries.filter((i) => i.messages.length > 0);
  const hours = answered
    .map((i) => (i.messages[0].createdAt - i.createdAt) / 3600000)
    .sort((a, b) => a - b);
  const median = hours.length ? hours[Math.floor(hours.length / 2)] : null;

  return {
    inquiryCount: inquiries.length,
    answeredRate: Math.round((answered.length / inquiries.length) * 100),
    medianResponseHours: median === null ? null : Math.round(median * 10) / 10,
  };
};

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

const publicBusinessSelect = {
  id: true,
  ownerId: true,
  name: true,
  category: { select: { id: true, name: true } },
  description: true,
  address: true,
  city: true,
  district: true,
  phone: true,
  website: true,
  workingHours: true,
  logo: true,
  photos: true,
  ratingAvg: true,
  ratingCount: true,
  isVerified: true,
  isFeatured: true,
  featuredUntil: true,
  createdAt: true,
};

// İşletme sahibinin / yöneticinin gördüğü alanlar (başvuru durumu dahil).
// Herkese açık yanıtlarda `rejectReason` ASLA dönmez.
const ownerBusinessSelect = {
  ...publicBusinessSelect,
  isActive: true,
  status: true,
  rejectReason: true,
  submittedAt: true,
  decidedAt: true,
};
const withStatus = (b) => (b ? { ...b, status: statusOf(b) } : b);

// Süresi geçen "öne çıkan" işletmeleri düşür (en fazla dakikada bir çalışır).
let lastFeaturedSweep = 0;
const sweepExpiredFeatured = async () => {
  const now = Date.now();
  if (now - lastFeaturedSweep < 60 * 1000) return;
  lastFeaturedSweep = now;
  try {
    await prisma.business.updateMany({
      where: { isFeatured: true, featuredUntil: { not: null, lt: new Date() } },
      data: { isFeatured: false, featuredUntil: null },
    });
  } catch (err) {
    console.error("sweepExpiredFeatured hatası:", err);
  }
};

// Yayında olan (onaylı + süresi dolmamış) kampanya filtresi
const activePostWhere = () => ({
  approved: true,
  OR: [{ expireDate: null }, { expireDate: { gt: new Date() } }],
});

// Türkiye saatine (UTC+3) göre bugünün tarihi: "2026-10-02"
const trDay = (offsetDays = 0) =>
  new Date(Date.now() + 3 * 3600 * 1000 - offsetDays * 86400 * 1000)
    .toISOString()
    .slice(0, 10);

// ---------- işletme listesi / detay ----------
export const listBusinesses = async (req, res) => {
  try {
    const page = toPage(req.query.page);
    const limit = toLimit(req.query.limit);

    const city = text(req.query.city);
    const district = text(req.query.district);
    const categoryId = text(req.query.category);
    const search = text(req.query.search).slice(0, 60);
    const minRating = parseFloat(req.query.minRating);
    const sort = text(req.query.sort);
    const exclude = text(req.query.exclude);
    const featuredOnly = req.query.featured === "1" || req.query.featured === "true";

    await sweepExpiredFeatured();

    const where = { isActive: true };
    if (isObjectId(exclude)) where.id = { not: exclude };
    if (featuredOnly) where.isFeatured = true;
    if (city) where.city = city;
    if (district) where.district = district;
    if (categoryId) {
      // Ana kategori seçildiyse alt kategorilerindeki işletmeler de gelsin
      const ids = isObjectId(categoryId)
        ? (
            await prisma.category.findMany({
              where: { OR: [{ id: categoryId }, { parentId: categoryId }] },
              select: { id: true },
            })
          ).map((c) => c.id)
        : [];
      where.categoryId = { in: ids };
    }
    if (search) where.name = { contains: search, mode: "insensitive" };
    if (!Number.isNaN(minRating) && minRating > 0) {
      where.ratingAvg = { gte: minRating };
    }

    // Öne çıkan işletmeler her sıralamada en üstte yer alır
    let orderBy = [{ isFeatured: "desc" }, { createdAt: "desc" }];
    if (sort === "rating") {
      orderBy = [{ isFeatured: "desc" }, { ratingAvg: "desc" }, { ratingCount: "desc" }];
    } else if (sort === "reviews") {
      orderBy = [{ isFeatured: "desc" }, { ratingCount: "desc" }, { ratingAvg: "desc" }];
    }

    const [items, total] = await Promise.all([
      prisma.business.findMany({
        where,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          name: true,
          category: { select: { id: true, name: true } },
          description: true,
          city: true,
          district: true,
          phone: true,
          logo: true,
          ratingAvg: true,
          ratingCount: true,
          isVerified: true,
          isFeatured: true,
        },
      }),
      prisma.business.count({ where }),
    ]);

    const data = items.map((b) => ({
      ...b,
      description: b.description ? b.description.slice(0, 140) : null,
    }));

    res.json({ data, total, page, limit });
  } catch (err) {
    console.error("listBusinesses hatası:", err);
    res.status(500).json({ message: "İşletmeler alınamadı" });
  }
};

export const getBusiness = async (req, res) => {
  const { id } = req.params;
  if (!isObjectId(id)) return res.status(404).json({ message: "İşletme bulunamadı" });

  try {
    await sweepExpiredFeatured();
    const business = await prisma.business.findFirst({
      where: { id, isActive: true },
      select: publicBusinessSelect,
    });
    if (!business) return res.status(404).json({ message: "İşletme bulunamadı" });
    const stats = await getResponseStats(business.ownerId).catch(() => null);
    res.json({ ...business, stats });
  } catch (err) {
    console.error("getBusiness hatası:", err);
    res.status(500).json({ message: "İşletme alınamadı" });
  }
};

// ---------- kendi işletme profilim ----------
export const getMyBusiness = async (req, res) => {
  try {
    const business = await prisma.business.findUnique({
      where: { ownerId: req.user.id },
      select: ownerBusinessSelect,
    });
    res.json(withStatus(business) || null);
  } catch (err) {
    console.error("getMyBusiness hatası:", err);
    res.status(500).json({ message: "İşletme profili alınamadı" });
  }
};

export const saveMyBusiness = async (req, res) => {
  if (!canManageBusiness(req.user)) {
    return res
      .status(403)
      .json({ message: "Sadece işyeri hesapları işletme profili oluşturabilir." });
  }

  const body = req.body || {};
  const name = text(body.name);
  const categoryId = text(body.categoryId);
  const description = text(body.description);
  const address = text(body.address);
  const city = text(body.city);
  const district = text(body.district);
  const workingHours = text(body.workingHours);
  const phone = text(body.phone).replace(/\D/g, "");

  if (name.length < 2 || name.length > 80) {
    return res.status(400).json({ message: "İşletme adı 2-80 karakter olmalı." });
  }
  if (description.length > 1000) {
    return res.status(400).json({ message: "Açıklama en fazla 1000 karakter olabilir." });
  }
  if (address.length < 5 || address.length > 200) {
    return res.status(400).json({ message: "Adres 5-200 karakter olmalı." });
  }
  if (!isValidLocation(city, district)) {
    return res.status(400).json({ message: "Geçerli bir il ve ilçe seçin." });
  }
  if (phone.length < 10 || phone.length > 13) {
    return res.status(400).json({ message: "Geçerli bir telefon numarası girin." });
  }
  if (workingHours.length > 400) {
    return res.status(400).json({ message: "Çalışma saatleri en fazla 400 karakter olabilir." });
  }
  if (!isClean(name) || !isClean(description)) {
    return res.status(400).json({ message: "Uygunsuz içerik tespit edildi." });
  }

  const website = normalizeWebsite(body.website);
  if (website === undefined) {
    return res.status(400).json({ message: "Geçerli bir web sitesi adresi girin." });
  }

  const logo = body.logo ? (isCloudinaryUrl(body.logo) ? body.logo : undefined) : null;
  if (logo === undefined) {
    return res.status(400).json({ message: "Geçersiz logo adresi." });
  }
  const photos = Array.isArray(body.photos)
    ? body.photos.filter(isCloudinaryUrl).slice(0, MAX_PHOTOS)
    : [];

  const data = {
    name,
    description: description || null,
    address,
    city,
    district,
    phone,
    website,
    workingHours: workingHours || null,
    logo,
    photos,
  };

  try {
    const category = await findUsableCategory(categoryId);
    if (!category) {
      return res.status(400).json({ message: "Geçerli bir kategori seçin." });
    }

    // Başvuru akışı: ilk kayıt "onay bekliyor" olarak açılır ve yönetici onaylayana
    // kadar herkese açık listelerde görünmez (isActive=false). Reddedilmiş bir
    // başvuru düzenlenip kaydedilirse yeniden onaya düşer. Yönetici hesabının
    // kendi işletmesi doğrudan onaylı açılır.
    const isAdminUser = req.user.role === "admin";
    const existing = await prisma.business.findUnique({
      where: { ownerId: req.user.id },
      select: { id: true, status: true },
    });

    let business;
    let applicationEvent = null; // "new" | "resubmit"
    if (!existing) {
      business = await prisma.business.create({
        data: {
          ...data,
          category: { connect: { id: category.id } },
          owner: { connect: { id: req.user.id } },
          ...(isAdminUser
            ? { status: "approved", decidedAt: new Date() }
            : { status: "pending", isActive: false, submittedAt: new Date() }),
        },
        select: ownerBusinessSelect,
      });
      if (!isAdminUser) applicationEvent = "new";
    } else {
      const resubmit = !isAdminUser && statusOf(existing) === "rejected";
      business = await prisma.business.update({
        where: { ownerId: req.user.id },
        data: {
          ...data,
          category: { connect: { id: category.id } },
          ...(resubmit
            ? { status: "pending", isActive: false, rejectReason: null, submittedAt: new Date() }
            : {}),
        },
        select: ownerBusinessSelect,
      });
      if (resubmit) applicationEvent = "resubmit";
    }
    if (applicationEvent) {
      notifyAdminsOfApplication(business, req.user.email, applicationEvent === "resubmit");
    }

    // Bu hesabın daha önce eklediği (henüz bağlanmamış) kampanyaları profile bağla
    await prisma.post
      .updateMany({
        where: { userId: req.user.id, businessId: null },
        data: { businessId: business.id },
      })
      .catch((err) => console.error("Kampanya bağlama hatası:", err));
    placesCache = { at: 0, data: null };

    res.json(withStatus(business));
  } catch (err) {
    console.error("saveMyBusiness hatası:", err);
    res.status(500).json({ message: "İşletme profili kaydedilemedi" });
  }
};

// ---------- yorumlar ----------
export const listReviews = async (req, res) => {
  const { id } = req.params;
  if (!isObjectId(id)) return res.status(404).json({ message: "İşletme bulunamadı" });

  try {
    const page = toPage(req.query.page);
    const limit = toLimit(req.query.limit, 10);

    const [items, total] = await Promise.all([
      prisma.businessReview.findMany({
        where: { businessId: id },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        include: { user: { select: { id: true, username: true, avatar: true } } },
      }),
      prisma.businessReview.count({ where: { businessId: id } }),
    ]);

    res.json({ data: items, total, page, limit });
  } catch (err) {
    console.error("listReviews hatası:", err);
    res.status(500).json({ message: "Yorumlar alınamadı" });
  }
};

export const getMyReview = async (req, res) => {
  const { id } = req.params;
  if (!isObjectId(id)) return res.json(null);

  try {
    const review = await prisma.businessReview.findUnique({
      where: { businessId_userId: { businessId: id, userId: req.user.id } },
    });
    res.json(review || null);
  } catch (err) {
    console.error("getMyReview hatası:", err);
    res.status(500).json({ message: "Yorum alınamadı" });
  }
};

// Kullanıcı başına işletme başına tek yorum: varsa günceller, yoksa oluşturur.
export const upsertReview = async (req, res) => {
  const { id } = req.params;
  if (!isObjectId(id)) return res.status(404).json({ message: "İşletme bulunamadı" });

  const rating = parseInt(req.body?.rating, 10);
  const comment = text(req.body?.comment);

  if (!(rating >= 1 && rating <= 5)) {
    return res.status(400).json({ message: "Puan 1 ile 5 arasında olmalı." });
  }
  if (comment.length > 500) {
    return res.status(400).json({ message: "Yorum en fazla 500 karakter olabilir." });
  }
  if (!isClean(comment)) {
    return res.status(400).json({ message: "Uygunsuz içerik tespit edildi." });
  }

  try {
    const business = await prisma.business.findFirst({
      where: { id, isActive: true },
      select: { id: true, ownerId: true, name: true, owner: { select: { email: true } } },
    });
    if (!business) return res.status(404).json({ message: "İşletme bulunamadı" });
    if (business.ownerId === req.user.id) {
      return res.status(403).json({ message: "Kendi işletmenizi değerlendiremezsiniz." });
    }

    const existing = await prisma.businessReview.findUnique({
      where: { businessId_userId: { businessId: id, userId: req.user.id } },
      select: { id: true },
    });

    const review = await prisma.businessReview.upsert({
      where: { businessId_userId: { businessId: id, userId: req.user.id } },
      create: {
        rating,
        comment: comment || null,
        business: { connect: { id } },
        user: { connect: { id: req.user.id } },
      },
      update: { rating, comment: comment || null },
    });

    await recomputeRating(id);

    // Sadece İLK yorumda işletme sahibine e-posta (yorum düzenlemeleri bildirim üretmez)
    if (!existing) {
      notifyOwnerNewReview({
        to: business.owner?.email,
        businessName: business.name,
        businessId: id,
        rating,
        comment: comment || "",
      });
      notifyUsers([business.ownerId], {
        title: `${business.name} için yeni yorum`,
        body: `${"★".repeat(rating)} ${previewText(comment || "Yorum yazılmadan puanlandı.", 100)}`,
        kind: "review",
        refId: id,
      });
    }
    res.status(201).json(review);
  } catch (err) {
    console.error("upsertReview hatası:", err);
    res.status(500).json({ message: "Yorum kaydedilemedi" });
  }
};

export const deleteReview = async (req, res) => {
  const { id, reviewId } = req.params;
  if (!isObjectId(id) || !isObjectId(reviewId)) {
    return res.status(404).json({ message: "Yorum bulunamadı" });
  }

  try {
    const review = await prisma.businessReview.findUnique({ where: { id: reviewId } });
    if (!review || review.businessId !== id) {
      return res.status(404).json({ message: "Yorum bulunamadı" });
    }
    if (review.userId !== req.user.id && req.user.role !== "admin") {
      return res.status(403).json({ message: "Bu yorumu silme yetkiniz yok." });
    }

    await prisma.businessReview.delete({ where: { id: reviewId } });
    await recomputeRating(id);
    res.json({ message: "Yorum silindi." });
  } catch (err) {
    console.error("deleteReview hatası:", err);
    res.status(500).json({ message: "Yorum silinemedi" });
  }
};

// ---------- özel soru-cevap (inquiry) ----------
export const createInquiry = async (req, res) => {
  const { id } = req.params;
  if (!isObjectId(id)) return res.status(404).json({ message: "İşletme bulunamadı" });

  const subject = text(req.body?.subject);
  const message = text(req.body?.message);

  if (subject.length < 3 || subject.length > 100) {
    return res.status(400).json({ message: "Konu 3-100 karakter olmalı." });
  }
  if (message.length < 5 || message.length > 1000) {
    return res.status(400).json({ message: "Mesaj 5-1000 karakter olmalı." });
  }
  if (!isClean(subject) || !isClean(message)) {
    return res.status(400).json({ message: "Uygunsuz içerik tespit edildi." });
  }

  try {
    const business = await prisma.business.findFirst({
      where: { id, isActive: true },
      select: { id: true, ownerId: true, name: true, owner: { select: { email: true } } },
    });
    if (!business) return res.status(404).json({ message: "İşletme bulunamadı" });
    if (business.ownerId === req.user.id) {
      return res.status(403).json({ message: "Kendi işletmenize soru soramazsınız." });
    }

    const openCount = await prisma.inquiry.count({
      where: { businessId: id, customerId: req.user.id, status: { not: "closed" } },
    });
    if (openCount >= MAX_OPEN_INQUIRIES_PER_BUSINESS) {
      return res.status(429).json({
        message:
          "Bu işletmeyle zaten birden fazla açık konuşmanız var. Mevcut sorularınıza devam edin.",
      });
    }

    const inquiry = await prisma.inquiry.create({
      data: {
        subject,
        status: "open",
        ownerUnread: true,
        customerUnread: false,
        business: { connect: { id } },
        customer: { connect: { id: req.user.id } },
        owner: { connect: { id: business.ownerId } },
        messages: { create: { text: message, sender: { connect: { id: req.user.id } } } },
      },
      select: { id: true },
    });

    notifyOwnerNewInquiry({
      to: business.owner?.email,
      businessName: business.name,
      subject,
      message,
    });

    notifyUsers([business.ownerId], {
      title: `Yeni soru: ${previewText(subject, 40)}`,
      body: previewText(message, 120),
      kind: "inquiry",
      refId: inquiry.id,
    });

    res.status(201).json(inquiry);
  } catch (err) {
    console.error("createInquiry hatası:", err);
    res.status(500).json({ message: "Soru gönderilemedi" });
  }
};

const lastMessageInclude = {
  messages: { orderBy: { createdAt: "desc" }, take: 1, select: { text: true, senderId: true, createdAt: true } },
};

// İşletme sahibine gelen sorular
export const listReceivedInquiries = async (req, res) => {
  try {
    const page = toPage(req.query.page);
    const limit = toLimit(req.query.limit, 20);
    const status = text(req.query.status);

    const where = { ownerId: req.user.id };
    if (["open", "answered", "closed"].includes(status)) where.status = status;

    const [items, total, unread] = await Promise.all([
      prisma.inquiry.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          customer: { select: { id: true, username: true } },
          business: { select: { id: true, name: true } },
          ...lastMessageInclude,
        },
      }),
      prisma.inquiry.count({ where }),
      prisma.inquiry.count({ where: { ownerId: req.user.id, ownerUnread: true } }),
    ]);

    res.json({ data: items, total, unread, page, limit });
  } catch (err) {
    console.error("listReceivedInquiries hatası:", err);
    res.status(500).json({ message: "Sorular alınamadı" });
  }
};

// Benim gönderdiğim sorular
export const listSentInquiries = async (req, res) => {
  try {
    const page = toPage(req.query.page);
    const limit = toLimit(req.query.limit, 20);

    const where = { customerId: req.user.id };

    const [items, total, unread] = await Promise.all([
      prisma.inquiry.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          business: { select: { id: true, name: true, logo: true } },
          ...lastMessageInclude,
        },
      }),
      prisma.inquiry.count({ where }),
      prisma.inquiry.count({ where: { customerId: req.user.id, customerUnread: true } }),
    ]);

    res.json({ data: items, total, unread, page, limit });
  } catch (err) {
    console.error("listSentInquiries hatası:", err);
    res.status(500).json({ message: "Sorular alınamadı" });
  }
};

const loadParticipantInquiry = async (inquiryId, userId) => {
  if (!isObjectId(inquiryId)) return null;
  const inquiry = await prisma.inquiry.findUnique({ where: { id: inquiryId } });
  if (!inquiry) return null;
  if (inquiry.customerId !== userId && inquiry.ownerId !== userId) return null;
  return inquiry;
};

export const getInquiry = async (req, res) => {
  try {
    const found = await loadParticipantInquiry(req.params.inquiryId, req.user.id);
    // Katılımcı olmayanlara varlığını da sızdırmamak için 404
    if (!found) return res.status(404).json({ message: "Konuşma bulunamadı" });

    const isOwner = found.ownerId === req.user.id;
    if (isOwner ? found.ownerUnread : found.customerUnread) {
      await prisma.inquiry.update({
        where: { id: found.id },
        data: isOwner ? { ownerUnread: false } : { customerUnread: false },
      });
    }

    const inquiry = await prisma.inquiry.findUnique({
      where: { id: found.id },
      include: {
        business: { select: { id: true, name: true, logo: true } },
        customer: { select: { id: true, username: true } },
        messages: { orderBy: { createdAt: "asc" } },
      },
    });

    res.json({ ...inquiry, viewerRole: isOwner ? "owner" : "customer" });
  } catch (err) {
    console.error("getInquiry hatası:", err);
    res.status(500).json({ message: "Konuşma alınamadı" });
  }
};

export const addInquiryMessage = async (req, res) => {
  const message = text(req.body?.message);
  if (message.length < 1 || message.length > 1000) {
    return res.status(400).json({ message: "Mesaj 1-1000 karakter olmalı." });
  }
  if (!isClean(message)) {
    return res.status(400).json({ message: "Uygunsuz içerik tespit edildi." });
  }

  try {
    const inquiry = await loadParticipantInquiry(req.params.inquiryId, req.user.id);
    if (!inquiry) return res.status(404).json({ message: "Konuşma bulunamadı" });
    if (inquiry.status === "closed") {
      return res.status(400).json({ message: "Bu konuşma kapatılmış." });
    }

    const fromOwner = inquiry.ownerId === req.user.id;

    const created = await prisma.inquiryMessage.create({
      data: {
        text: message,
        inquiry: { connect: { id: inquiry.id } },
        sender: { connect: { id: req.user.id } },
      },
    });

    await prisma.inquiry.update({
      where: { id: inquiry.id },
      data: fromOwner
        ? { status: "answered", customerUnread: true, ownerUnread: false }
        : { status: "open", ownerUnread: true, customerUnread: false },
    });

    // Karşı tarafa mobil bildirim
    prisma.inquiry
      .findUnique({
        where: { id: inquiry.id },
        select: {
          business: { select: { name: true } },
          customer: { select: { username: true } },
        },
      })
      .then((info) =>
        notifyUsers([fromOwner ? inquiry.customerId : inquiry.ownerId], {
          title: fromOwner
            ? info?.business?.name || "İşletme"
            : info?.customer?.username || "Müşteri",
          body: previewText(message, 120),
          kind: "inquiry",
          refId: inquiry.id,
        }),
      )
      .catch((err) => console.error("Push hazırlanamadı:", err));

    // E-posta yalnızca karşı tarafın "okunmamış" durumu false -> true olurken
    // gönderilir; arka arkaya yazılan mesajlar gelen kutusunu mail yağmuruna çevirmez.
    const needsMail = fromOwner ? !inquiry.customerUnread : !inquiry.ownerUnread;
    if (needsMail) {
      prisma.inquiry
        .findUnique({
          where: { id: inquiry.id },
          select: {
            subject: true,
            business: { select: { name: true } },
            customer: { select: { email: true } },
            owner: { select: { email: true } },
          },
        })
        .then((info) => {
          if (!info) return;
          const payload = {
            businessName: info.business?.name || "İşletme",
            subject: info.subject,
            message,
          };
          if (fromOwner) notifyCustomerReply({ ...payload, to: info.customer?.email });
          else notifyOwnerNewMessage({ ...payload, to: info.owner?.email });
        })
        .catch((err) => console.error("Bildirim hazırlanamadı:", err));
    }

    res.status(201).json(created);
  } catch (err) {
    console.error("addInquiryMessage hatası:", err);
    res.status(500).json({ message: "Mesaj gönderilemedi" });
  }
};

export const closeInquiry = async (req, res) => {
  try {
    const inquiry = await loadParticipantInquiry(req.params.inquiryId, req.user.id);
    if (!inquiry) return res.status(404).json({ message: "Konuşma bulunamadı" });

    await prisma.inquiry.update({
      where: { id: inquiry.id },
      data: { status: "closed" },
    });
    res.json({ message: "Konuşma kapatıldı." });
  } catch (err) {
    console.error("closeInquiry hatası:", err);
    res.status(500).json({ message: "Konuşma kapatılamadı" });
  }
};

// ====================== YORUMA İŞLETME YANITI ======================
const loadOwnedReview = async (businessId, reviewId, userId) => {
  if (!isObjectId(businessId) || !isObjectId(reviewId)) return { status: 404 };
  const review = await prisma.businessReview.findUnique({
    where: { id: reviewId },
    include: {
      business: { select: { id: true, name: true, ownerId: true } },
      user: { select: { email: true } },
    },
  });
  if (!review || review.businessId !== businessId) return { status: 404 };
  if (review.business.ownerId !== userId) return { status: 403 };
  return { review };
};

export const replyToReview = async (req, res) => {
  const reply = text(req.body?.reply);
  if (reply.length < 2 || reply.length > 500) {
    return res.status(400).json({ message: "Yanıt 2-500 karakter olmalı." });
  }
  if (!isClean(reply)) {
    return res.status(400).json({ message: "Uygunsuz içerik tespit edildi." });
  }

  try {
    const { review, status } = await loadOwnedReview(req.params.id, req.params.reviewId, req.user.id);
    if (!review) {
      return res
        .status(status)
        .json({ message: status === 403 ? "Sadece işletme sahibi yanıt verebilir." : "Yorum bulunamadı" });
    }

    const updated = await prisma.businessReview.update({
      where: { id: review.id },
      data: { ownerReply: reply, ownerReplyAt: new Date() },
    });

    // İlk yanıtta yorum sahibine e-posta
    if (!review.ownerReply) {
      notifyReviewerReply({
        to: review.user?.email,
        businessName: review.business.name,
        businessId: review.business.id,
        reply,
      });
      notifyUsers([review.userId], {
        title: `${review.business.name} yorumunuza yanıt verdi`,
        body: previewText(reply, 120),
        kind: "review",
        refId: review.business.id,
      });
    }
    res.json(updated);
  } catch (err) {
    console.error("replyToReview hatası:", err);
    res.status(500).json({ message: "Yanıt kaydedilemedi" });
  }
};

export const deleteReviewReply = async (req, res) => {
  try {
    const { review, status } = await loadOwnedReview(req.params.id, req.params.reviewId, req.user.id);
    if (!review) {
      return res
        .status(status)
        .json({ message: status === 403 ? "Sadece işletme sahibi yanıtı silebilir." : "Yorum bulunamadı" });
    }
    const updated = await prisma.businessReview.update({
      where: { id: review.id },
      data: { ownerReply: null, ownerReplyAt: null },
    });
    res.json(updated);
  } catch (err) {
    console.error("deleteReviewReply hatası:", err);
    res.status(500).json({ message: "Yanıt silinemedi" });
  }
};

// ====================== FAVORİLER ======================
export const getFavoriteState = async (req, res) => {
  const { id } = req.params;
  if (!isObjectId(id)) return res.json({ favorite: false });
  try {
    const fav = await prisma.businessFavorite.findUnique({
      where: { userId_businessId: { userId: req.user.id, businessId: id } },
      select: { id: true },
    });
    res.json({ favorite: !!fav });
  } catch (err) {
    console.error("getFavoriteState hatası:", err);
    res.status(500).json({ message: "Favori durumu alınamadı" });
  }
};

export const addFavorite = async (req, res) => {
  const { id } = req.params;
  if (!isObjectId(id)) return res.status(404).json({ message: "İşletme bulunamadı" });
  try {
    const business = await prisma.business.findFirst({
      where: { id, isActive: true },
      select: { id: true },
    });
    if (!business) return res.status(404).json({ message: "İşletme bulunamadı" });

    await prisma.businessFavorite.upsert({
      where: { userId_businessId: { userId: req.user.id, businessId: id } },
      create: { user: { connect: { id: req.user.id } }, business: { connect: { id } } },
      update: {},
    });
    res.status(201).json({ favorite: true });
  } catch (err) {
    console.error("addFavorite hatası:", err);
    res.status(500).json({ message: "Favorilere eklenemedi" });
  }
};

export const removeFavorite = async (req, res) => {
  const { id } = req.params;
  if (!isObjectId(id)) return res.json({ favorite: false });
  try {
    await prisma.businessFavorite.deleteMany({
      where: { userId: req.user.id, businessId: id },
    });
    res.json({ favorite: false });
  } catch (err) {
    console.error("removeFavorite hatası:", err);
    res.status(500).json({ message: "Favorilerden çıkarılamadı" });
  }
};

export const listMyFavorites = async (req, res) => {
  try {
    const favs = await prisma.businessFavorite.findMany({
      where: { userId: req.user.id, business: { isActive: true } },
      orderBy: { createdAt: "desc" },
      take: 200,
      select: {
        createdAt: true,
        business: {
          select: {
            id: true,
            name: true,
            category: { select: { id: true, name: true } },
            description: true,
            city: true,
            district: true,
            phone: true,
            logo: true,
            ratingAvg: true,
            ratingCount: true,
            isVerified: true,
            isFeatured: true,
          },
        },
      },
    });
    const data = favs.map((f) => ({
      ...f.business,
      description: f.business.description ? f.business.description.slice(0, 140) : null,
      favoritedAt: f.createdAt,
    }));
    res.json({ data, total: data.length });
  } catch (err) {
    console.error("listMyFavorites hatası:", err);
    res.status(500).json({ message: "Favoriler alınamadı" });
  }
};

// ====================== İŞLETMENİN AKTİF KAMPANYALARI ======================
export const listBusinessPosts = async (req, res) => {
  const { id } = req.params;
  if (!isObjectId(id)) return res.json({ data: [] });
  try {
    const posts = await prisma.post.findMany({
      where: { businessId: id, ...activePostWhere() },
      orderBy: { createdAt: "desc" },
      take: 12,
      select: {
        id: true,
        title: true,
        price: true,
        images: true,
        city: true,
        district: true,
        listingType: true,
        expireDate: true,
        postDetail: { select: { discountAmount: true } },
      },
    });
    res.json({ data: posts });
  } catch (err) {
    console.error("listBusinessPosts hatası:", err);
    res.status(500).json({ message: "Kampanyalar alınamadı" });
  }
};

// ====================== İSTATİSTİK TAKİBİ ======================
const TRACK_FIELDS = { view: "views", call: "calls", directions: "directions" };

export const trackEvent = async (req, res) => {
  const { id } = req.params;
  const field = TRACK_FIELDS[req.body?.type];
  // Sessizce 204: istemci tarafında hiçbir şeyi bozmasın
  if (!isObjectId(id) || !field) return res.status(204).end();

  try {
    const business = await prisma.business.findFirst({
      where: { id, isActive: true },
      select: { id: true },
    });
    if (!business) return res.status(204).end();

    const date = trDay();
    const key = { businessId_date: { businessId: id, date } };
    const bump = async () => {
      await prisma.businessDailyStat.upsert({
        where: key,
        create: { business: { connect: { id } }, date, [field]: 1 },
        update: { [field]: { increment: 1 } },
      });
    };
    try {
      await bump();
    } catch (err) {
      // Aynı gün ilk kayıt iki istek tarafından aynı anda oluşturulursa bir kez daha dene
      if (err?.code === "P2002") await bump();
      else throw err;
    }
    res.status(204).end();
  } catch (err) {
    console.error("trackEvent hatası:", err);
    res.status(204).end();
  }
};

export const getMyStats = async (req, res) => {
  try {
    const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 7), 90);
    const business = await prisma.business.findUnique({
      where: { ownerId: req.user.id },
      select: { id: true, ratingAvg: true, ratingCount: true },
    });
    if (!business) return res.json(null);

    const dates = Array.from({ length: days }, (_, i) => trDay(days - 1 - i));
    const [rows, favoriteCount, inquiryTotal, openInquiries, activePosts, recentReviews] =
      await Promise.all([
        prisma.businessDailyStat.findMany({
          where: { businessId: business.id, date: { gte: dates[0] } },
        }),
        prisma.businessFavorite.count({ where: { businessId: business.id } }),
        prisma.inquiry.count({ where: { businessId: business.id } }),
        prisma.inquiry.count({ where: { businessId: business.id, status: "open" } }),
        prisma.post.count({ where: { businessId: business.id, ...activePostWhere() } }),
        prisma.businessReview.count({
          where: {
            businessId: business.id,
            createdAt: { gte: new Date(Date.now() - days * 86400 * 1000) },
          },
        }),
      ]);

    const byDate = new Map(rows.map((r) => [r.date, r]));
    const series = dates.map((date) => {
      const r = byDate.get(date);
      return {
        date,
        views: r?.views || 0,
        calls: r?.calls || 0,
        directions: r?.directions || 0,
      };
    });
    const sum = (k) => series.reduce((a, d) => a + d[k], 0);

    res.json({
      days,
      series,
      totals: { views: sum("views"), calls: sum("calls"), directions: sum("directions") },
      favoriteCount,
      inquiryTotal,
      openInquiries,
      activePosts,
      recentReviews,
      ratingAvg: business.ratingAvg,
      ratingCount: business.ratingCount,
    });
  } catch (err) {
    console.error("getMyStats hatası:", err);
    res.status(500).json({ message: "İstatistikler alınamadı" });
  }
};

// ====================== YER LİSTESİ (SEO / yakınımdakiler) ======================
let placesCache = { at: 0, data: null };
export const getPlaces = async (req, res) => {
  try {
    if (placesCache.data && Date.now() - placesCache.at < 10 * 60 * 1000) {
      return res.json(placesCache.data);
    }
    const groups = await prisma.business.groupBy({
      by: ["city", "district"],
      where: { isActive: true },
      _count: { _all: true },
    });
    const cityMap = new Map();
    for (const g of groups) {
      const c = cityMap.get(g.city) || { city: g.city, count: 0, districts: [] };
      c.count += g._count._all;
      c.districts.push({ district: g.district, count: g._count._all });
      cityMap.set(g.city, c);
    }
    const data = [...cityMap.values()]
      .map((c) => ({ ...c, districts: c.districts.sort((a, b) => b.count - a.count) }))
      .sort((a, b) => b.count - a.count);
    placesCache = { at: Date.now(), data };
    res.json(data);
  } catch (err) {
    console.error("getPlaces hatası:", err);
    res.status(500).json({ message: "Yerler alınamadı" });
  }
};

// ====================== YÖNETİCİ ======================
export const adminListBusinesses = async (req, res) => {
  try {
    const page = toPage(req.query.page);
    const limit = toLimit(req.query.limit, 20);
    const search = text(req.query.search).slice(0, 60);
    const filter = text(req.query.filter);

    await sweepExpiredFeatured();

    const where = {};
    if (search) where.name = { contains: search, mode: "insensitive" };
    if (filter === "verified") where.isVerified = true;
    if (filter === "unverified") where.isVerified = { not: true };
    if (filter === "featured") where.isFeatured = true;
    if (filter === "inactive") where.isActive = false;
    if (filter === "pending") where.status = "pending";
    if (filter === "rejected") where.status = "rejected";

    const [items, total, pending] = await Promise.all([
      prisma.business.findMany({
        where,
        // Onay bekleyenlerde en eski başvuru en üstte (sıraya göre karşılanır)
        orderBy: filter === "pending" ? { submittedAt: "asc" } : { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          name: true,
          city: true,
          district: true,
          address: true,
          phone: true,
          description: true,
          workingHours: true,
          website: true,
          photos: true,
          status: true,
          rejectReason: true,
          submittedAt: true,
          decidedAt: true,
          logo: true,
          isActive: true,
          isVerified: true,
          isFeatured: true,
          featuredUntil: true,
          ratingAvg: true,
          ratingCount: true,
          createdAt: true,
          category: { select: { name: true } },
          owner: { select: { username: true, email: true } },
        },
      }),
      prisma.business.count({ where }),
      prisma.business.count({ where: { status: "pending" } }),
    ]);
    res.json({
      data: items.map((b) => ({
        ...b,
        status: statusOf(b),
        description: b.description ? b.description.slice(0, 300) : null,
        photos: (b.photos || []).slice(0, 4),
      })),
      total,
      pending,
      page,
      limit,
    });
  } catch (err) {
    console.error("adminListBusinesses hatası:", err);
    res.status(500).json({ message: "İşletmeler alınamadı" });
  }
};

export const adminUpdateBusiness = async (req, res) => {
  const { id } = req.params;
  if (!isObjectId(id)) return res.status(404).json({ message: "İşletme bulunamadı" });

  const body = req.body || {};
  const data = {};
  if (typeof body.isVerified === "boolean") data.isVerified = body.isVerified;
  if (typeof body.isActive === "boolean") data.isActive = body.isActive;
  if (typeof body.isFeatured === "boolean") {
    if (body.isFeatured) {
      const days = Math.min(Math.max(parseInt(body.featuredDays, 10) || 30, 1), 365);
      data.isFeatured = true;
      data.featuredUntil = new Date(Date.now() + days * 86400 * 1000);
    } else {
      data.isFeatured = false;
      data.featuredUntil = null;
    }
  }
  if (Object.keys(data).length === 0) {
    return res.status(400).json({ message: "Güncellenecek alan yok." });
  }

  try {
    const current = await prisma.business.findUnique({
      where: { id },
      select: { id: true, ownerId: true, name: true, status: true },
    });
    if (!current) return res.status(404).json({ message: "İşletme bulunamadı" });

    // Rozet ve öne çıkarma yalnızca onaylı işletmelere verilir.
    let approvedNow = false;
    if (statusOf(current) !== "approved") {
      if (data.isVerified === true || data.isFeatured === true) {
        return res
          .status(400)
          .json({ message: "Önce işletme başvurusunu onaylayın." });
      }
      if (data.isActive === true) {
        // Onay bekleyen/reddedilen işletmeyi "yayına al" = başvuruyu onayla
        data.status = "approved";
        data.rejectReason = null;
        data.decidedAt = new Date();
        approvedNow = true;
      } else {
        // Henüz onaylanmamış işletme zaten yayında değil
        delete data.isActive;
      }
      if (Object.keys(data).length === 0) {
        return res.status(400).json({ message: "Güncellenecek alan yok." });
      }
    }

    const updated = await prisma.business.update({
      where: { id },
      data,
      select: {
        id: true,
        ownerId: true,
        name: true,
        status: true,
        isActive: true,
        isVerified: true,
        isFeatured: true,
        featuredUntil: true,
      },
    });
    placesCache = { at: 0, data: null };
    if (approvedNow) notifyApplicant(updated, "approved");
    const { ownerId: _o, name: _n, ...rest } = updated;
    res.json({ ...rest, status: statusOf(updated) });
  } catch (err) {
    if (err?.code === "P2025") return res.status(404).json({ message: "İşletme bulunamadı" });
    console.error("adminUpdateBusiness hatası:", err);
    res.status(500).json({ message: "İşletme güncellenemedi" });
  }
};

// Başvuruyu onayla: işletme herkese açık olur, sahibine bildirim gider.
export const adminApproveBusiness = async (req, res) => {
  const { id } = req.params;
  if (!isObjectId(id)) return res.status(404).json({ message: "İşletme bulunamadı" });

  try {
    const current = await prisma.business.findUnique({
      where: { id },
      select: { id: true, status: true },
    });
    if (!current) return res.status(404).json({ message: "İşletme bulunamadı" });
    if (statusOf(current) === "approved") {
      return res.status(400).json({ message: "Bu işletme zaten onaylı." });
    }

    const updated = await prisma.business.update({
      where: { id },
      data: { status: "approved", isActive: true, rejectReason: null, decidedAt: new Date() },
      select: { id: true, ownerId: true, name: true, status: true, isActive: true, decidedAt: true },
    });
    placesCache = { at: 0, data: null };
    notifyApplicant(updated, "approved");
    res.json({ id: updated.id, status: updated.status, isActive: updated.isActive });
  } catch (err) {
    console.error("adminApproveBusiness hatası:", err);
    res.status(500).json({ message: "Başvuru onaylanamadı" });
  }
};

// Başvuruyu reddet (gerekçe zorunlu): işletme gizli kalır, sahibi düzeltip yeniden gönderebilir.
export const adminRejectBusiness = async (req, res) => {
  const { id } = req.params;
  if (!isObjectId(id)) return res.status(404).json({ message: "İşletme bulunamadı" });

  const reason = text((req.body || {}).reason);
  if (reason.length < 3 || reason.length > 300) {
    return res.status(400).json({ message: "Gerekçe 3-300 karakter olmalı." });
  }

  try {
    const current = await prisma.business.findUnique({
      where: { id },
      select: { id: true, status: true },
    });
    if (!current) return res.status(404).json({ message: "İşletme bulunamadı" });
    if (statusOf(current) === "approved") {
      return res.status(400).json({
        message: "Onaylı işletme reddedilemez; gerekirse yayından kaldırın.",
      });
    }

    const updated = await prisma.business.update({
      where: { id },
      data: { status: "rejected", isActive: false, rejectReason: reason, decidedAt: new Date() },
      select: { id: true, ownerId: true, name: true, status: true, isActive: true },
    });
    placesCache = { at: 0, data: null };
    notifyApplicant(updated, "rejected", reason);
    res.json({ id: updated.id, status: updated.status, isActive: updated.isActive, rejectReason: reason });
  } catch (err) {
    console.error("adminRejectBusiness hatası:", err);
    res.status(500).json({ message: "Başvuru reddedilemedi" });
  }
};
