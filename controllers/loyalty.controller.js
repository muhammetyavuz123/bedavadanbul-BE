import jwt from "jsonwebtoken";
import crypto from "crypto";
import prisma from "../lib/prisma.js";

// ======================================================================
// SADAKAT: QR ile adet (5 kahveye 1 hediye) ya da puan (100 TL = 10 puan)
//
// Akış:
//  1) Müşteri uygulamada kısa süreli (90 sn) yenilenen QR'ını gösterir.
//  2) İşletme kendi hesabıyla QR'ı okutur, adedi (stamp) ya da tutarı
//     (points) girer.
//  3) Adet hedefe ulaşınca (ya da müşteri puanıyla ödül seçince) bir hediye
//     KUPONU oluşur. Kupon QR'ı işletme tarafından okutulunca "kullanıldı"
//     olur.
//
// Not: Tutar/adet işletme çalışanının beyanıdır (kasa entegrasyonu yok);
// bu yüzden her işlem LoyaltyEvent olarak kayıt altında tutulur.
// ======================================================================

const OID = /^[a-f\d]{24}$/i;
const isObjectId = (v) => typeof v === "string" && OID.test(v);

const TYPES = ["stamp", "points"];
const QR_TTL_SEC = 90;
const QR_PREFIX = "BBU:";
const COUPON_PREFIX = "BBK:";
const CODE_RE = /^[A-F0-9]{12}$/;

// Oturum token'ından (JWT_SECRET) ayrı bir imza anahtarı: QR token'ı asla
// giriş token'ı olarak kullanılamaz ve tersi de geçerli değildir.
const qrSecret = () => `${process.env.JWT_SECRET}:loyalty-qr-v1`;

const intIn = (v, min, max) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
};

const cleanText = (v, min, max) => {
  if (typeof v !== "string") return null;
  const t = v.trim().replace(/\s+/g, " ");
  return t.length >= min && t.length <= max ? t : null;
};

const maskName = (name) => {
  const s = String(name || "").trim();
  if (!s) return "Müşteri";
  return `${s.slice(0, 2)}***`;
};

const newCode = () => crypto.randomBytes(6).toString("hex").toUpperCase();

const programDTO = (p) => ({
  id: p.id,
  businessId: p.businessId,
  type: p.type,
  isActive: p.isActive,
  goal: p.goal,
  rewardText: p.rewardText,
  earnAmount: p.earnAmount,
  earnPoints: p.earnPoints,
  minIntervalMin: p.minIntervalMin,
  rewards: (p.rewards || [])
    .slice()
    .sort((a, b) => a.cost - b.cost)
    .map((r) => ({ id: r.id, name: r.name, cost: r.cost })),
});

const couponDTO = (c) => ({
  id: c.id,
  code: c.code,
  qr: `${COUPON_PREFIX}${c.code}`,
  rewardName: c.rewardName,
  cost: c.cost,
  status: c.status,
  businessId: c.businessId,
  createdAt: c.createdAt,
  usedAt: c.usedAt,
});

const getOwnBusiness = (userId) =>
  prisma.business.findUnique({
    where: { ownerId: userId },
    select: { id: true, name: true },
  });

// Aynı sunucu tarafı yardımcı: programa yeni kupon(lar) yaz
const createCoupons = async ({ card, program, count, rewardName, cost }) => {
  const created = [];
  for (let i = 0; i < count; i += 1) {
    let coupon = null;
    for (let attempt = 0; attempt < 3 && !coupon; attempt += 1) {
      try {
        coupon = await prisma.loyaltyCoupon.create({
          data: {
            card: { connect: { id: card.id } },
            programId: program.id,
            businessId: program.businessId,
            userId: card.userId,
            rewardName,
            cost,
            code: newCode(),
          },
        });
      } catch (err) {
        // Kod çakışması (çok düşük olasılık) -> yeniden dene
        if (attempt === 2) throw err;
      }
    }
    created.push(coupon);
  }
  return created;
};

// =====================================================================
// İŞLETME
// =====================================================================

// GET /api/loyalty/me/program
export const getMyProgram = async (req, res) => {
  try {
    const biz = await getOwnBusiness(req.user.id);
    if (!biz) return res.status(403).json({ message: "İşletme hesabı gerekli." });

    const program = await prisma.loyaltyProgram.findUnique({
      where: { businessId: biz.id },
      include: { rewards: true },
    });
    if (!program) return res.json({ program: null, stats: null });

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const [cards, scansToday, activeCoupons, usedCoupons] = await Promise.all([
      prisma.loyaltyCard.count({ where: { programId: program.id } }),
      prisma.loyaltyEvent.count({
        where: { businessId: biz.id, kind: "earn", createdAt: { gte: startOfDay } },
      }),
      prisma.loyaltyCoupon.count({ where: { programId: program.id, status: "active" } }),
      prisma.loyaltyCoupon.count({ where: { programId: program.id, status: "used" } }),
    ]);

    res.json({
      program: programDTO(program),
      stats: { cards, scansToday, activeCoupons, usedCoupons },
    });
  } catch (err) {
    console.error("getMyProgram hatası:", err);
    res.status(500).json({ message: "Program alınamadı" });
  }
};

// PUT /api/loyalty/me/program
export const saveMyProgram = async (req, res) => {
  try {
    const biz = await getOwnBusiness(req.user.id);
    if (!biz) return res.status(403).json({ message: "İşletme hesabı gerekli." });

    const b = req.body || {};
    const type = TYPES.includes(b.type) ? b.type : null;
    if (!type) return res.status(400).json({ message: "Program türü geçersiz." });

    const minIntervalMin = b.minIntervalMin === undefined ? 10 : intIn(b.minIntervalMin, 1, 720);
    if (minIntervalMin === null) {
      return res.status(400).json({ message: "Bekleme süresi 1-720 dakika olmalı." });
    }
    const isActive = b.isActive === undefined ? true : b.isActive === true;

    const data = { type, isActive, minIntervalMin };
    let rewards = [];

    if (type === "stamp") {
      const goal = intIn(b.goal, 2, 50);
      const rewardText = cleanText(b.rewardText, 2, 80);
      if (goal === null) return res.status(400).json({ message: "Hedef adet 2-50 arasında olmalı." });
      if (!rewardText) return res.status(400).json({ message: "Hediye metni 2-80 karakter olmalı." });
      data.goal = goal;
      data.rewardText = rewardText;
    } else {
      const earnAmount = intIn(b.earnAmount, 1, 100000);
      const earnPoints = intIn(b.earnPoints, 1, 100000);
      if (earnAmount === null || earnPoints === null) {
        return res.status(400).json({ message: "Puan kuralı geçersiz (TL ve puan 1 ve üzeri olmalı)." });
      }
      if (!Array.isArray(b.rewards) || b.rewards.length < 1 || b.rewards.length > 10) {
        return res.status(400).json({ message: "En az 1, en fazla 10 ödül tanımlayın." });
      }
      for (const r of b.rewards) {
        const name = cleanText(r?.name, 2, 80);
        const cost = intIn(r?.cost, 1, 1000000);
        if (!name || cost === null) {
          return res.status(400).json({ message: "Ödül adı 2-80 karakter, puan bedeli 1 ve üzeri olmalı." });
        }
        rewards.push({ name, cost });
      }
      data.earnAmount = earnAmount;
      data.earnPoints = earnPoints;
    }

    const existing = await prisma.loyaltyProgram.findUnique({
      where: { businessId: biz.id },
      select: { id: true, type: true },
    });

    // Müşteri kartları varken tür değişirse adet ile puan birbirine karışır
    if (existing && existing.type !== type) {
      const cards = await prisma.loyaltyCard.count({ where: { programId: existing.id } });
      if (cards > 0) {
        return res.status(409).json({
          message:
            "Müşteri kartları oluştuğu için program türü değiştirilemez. Programı pasif yapabilir ya da türü aynı bırakıp ayarları düzenleyebilirsiniz.",
        });
      }
    }

    let program;
    if (existing) {
      program = await prisma.loyaltyProgram.update({ where: { id: existing.id }, data });
    } else {
      program = await prisma.loyaltyProgram.create({
        data: { ...data, business: { connect: { id: biz.id } } },
      });
    }

    // Ödül listesi yeniden yazılır (kuponlar ödül adını ve bedelini kopyalar, etkilenmez)
    await prisma.loyaltyReward.deleteMany({ where: { programId: program.id } });
    if (type === "points" && rewards.length) {
      await prisma.loyaltyReward.createMany({
        data: rewards.map((r) => ({ programId: program.id, name: r.name, cost: r.cost })),
      });
    }

    const full = await prisma.loyaltyProgram.findUnique({
      where: { id: program.id },
      include: { rewards: true },
    });
    res.json({ program: programDTO(full) });
  } catch (err) {
    console.error("saveMyProgram hatası:", err);
    res.status(500).json({ message: "Program kaydedilemedi" });
  }
};

// POST /api/loyalty/scan   { token, amount }
// stamp: amount = adet (1-20) | points: amount = TL (1-1.000.000)
export const scanCustomer = async (req, res) => {
  try {
    const biz = await getOwnBusiness(req.user.id);
    if (!biz) return res.status(403).json({ message: "İşletme hesabı gerekli." });

    const program = await prisma.loyaltyProgram.findUnique({ where: { businessId: biz.id } });
    if (!program || !program.isActive) {
      return res.status(400).json({ message: "Aktif bir sadakat programınız yok." });
    }

    let raw = String(req.body?.token || "").trim();
    if (raw.startsWith(QR_PREFIX)) raw = raw.slice(QR_PREFIX.length);
    let payload;
    try {
      payload = jwt.verify(raw, qrSecret());
    } catch {
      return res.status(400).json({
        message: "QR geçersiz ya da süresi dolmuş. Müşteri uygulamadaki QR'ı yenilesin.",
      });
    }
    if (payload.kind !== "user" || !isObjectId(payload.uid)) {
      return res.status(400).json({ message: "Bu bir müşteri QR'ı değil." });
    }
    if (payload.uid === req.user.id) {
      return res.status(403).json({ message: "Kendi QR'ınızı okutamazsınız." });
    }

    const customer = await prisma.user.findUnique({
      where: { id: payload.uid },
      select: { id: true, username: true },
    });
    if (!customer) return res.status(404).json({ message: "Müşteri bulunamadı." });

    // Girilen miktarı doğrula ve kazanımı hesapla
    let amount;
    let gain;
    if (program.type === "stamp") {
      amount = intIn(req.body?.amount, 1, 20);
      if (amount === null) return res.status(400).json({ message: "Adet 1-20 arasında olmalı." });
      gain = amount;
    } else {
      amount = intIn(req.body?.amount, 1, 1000000);
      if (amount === null) return res.status(400).json({ message: "Tutar 1-1.000.000 TL arasında olmalı." });
      gain = Math.floor((amount * program.earnPoints) / program.earnAmount);
      if (gain < 1) {
        const min = Math.ceil(program.earnAmount / program.earnPoints);
        return res.status(400).json({ message: `Bu tutar puan için çok düşük (en az ${min} TL).` });
      }
    }

    const card = await prisma.loyaltyCard.upsert({
      where: { programId_userId: { programId: program.id, userId: customer.id } },
      create: {
        program: { connect: { id: program.id } },
        user: { connect: { id: customer.id } },
        lastEarnAt: new Date(0),
      },
      update: {},
    });

    // Aynı karta kısa aralıkla tekrar ekleme: koşullu updateMany ile atomik
    const now = new Date();
    const threshold = new Date(now.getTime() - program.minIntervalMin * 60 * 1000);
    const claim = await prisma.loyaltyCard.updateMany({
      where: { id: card.id, lastEarnAt: { lt: threshold } },
      data: {
        lastEarnAt: now,
        progress: { increment: gain },
        totalEarned: { increment: gain },
      },
    });
    if (claim.count !== 1) {
      const waitMs = card.lastEarnAt.getTime() + program.minIntervalMin * 60 * 1000 - now.getTime();
      const waitMin = Math.max(1, Math.ceil(waitMs / 60000));
      return res.status(429).json({
        message: `Bu müşteriye az önce işlem yapıldı. ${waitMin} dakika sonra tekrar deneyin.`,
      });
    }

    let couponsCreated = [];
    if (program.type === "stamp") {
      const fresh = await prisma.loyaltyCard.findUnique({ where: { id: card.id } });
      if (fresh.progress >= program.goal) {
        const n = Math.floor(fresh.progress / program.goal);
        const dec = await prisma.loyaltyCard.updateMany({
          where: { id: card.id, progress: { gte: n * program.goal } },
          data: { progress: { decrement: n * program.goal } },
        });
        if (dec.count === 1) {
          couponsCreated = await createCoupons({
            card,
            program,
            count: n,
            rewardName: program.rewardText,
            cost: 0,
          });
        }
      }
    }

    await prisma.loyaltyEvent.create({
      data: {
        programId: program.id,
        businessId: biz.id,
        userId: customer.id,
        cashierId: req.user.id,
        kind: "earn",
        amount,
        delta: gain,
      },
    });

    const after = await prisma.loyaltyCard.findUnique({ where: { id: card.id } });
    res.json({
      customer: { name: maskName(customer.username) },
      type: program.type,
      gained: gain,
      progress: after.progress,
      goal: program.type === "stamp" ? program.goal : null,
      remaining: program.type === "stamp" ? program.goal - after.progress : null,
      couponsCreated: couponsCreated.length,
      rewardText: program.type === "stamp" ? program.rewardText : null,
    });
  } catch (err) {
    console.error("scanCustomer hatası:", err);
    res.status(500).json({ message: "İşlem yapılamadı" });
  }
};

// GET /api/loyalty/coupons/lookup/:code  (işletme: kupon QR'ı okutunca önce bilgi gösterir)
export const lookupCoupon = async (req, res) => {
  try {
    const biz = await getOwnBusiness(req.user.id);
    if (!biz) return res.status(403).json({ message: "İşletme hesabı gerekli." });

    let code = String(req.params.code || "").trim().toUpperCase();
    if (code.startsWith(COUPON_PREFIX)) code = code.slice(COUPON_PREFIX.length);
    if (!CODE_RE.test(code)) return res.status(404).json({ message: "Kupon bulunamadı." });

    const coupon = await prisma.loyaltyCoupon.findUnique({ where: { code } });
    if (!coupon || coupon.businessId !== biz.id) {
      return res.status(404).json({ message: "Kupon bulunamadı ya da bu işletmeye ait değil." });
    }
    const user = await prisma.user.findUnique({
      where: { id: coupon.userId },
      select: { username: true },
    });
    res.json({
      coupon: {
        ...couponDTO(coupon),
        customerName: maskName(user?.username),
      },
    });
  } catch (err) {
    console.error("lookupCoupon hatası:", err);
    res.status(500).json({ message: "Kupon sorgulanamadı" });
  }
};

// POST /api/loyalty/coupons/use  { code }
export const useCoupon = async (req, res) => {
  try {
    const biz = await getOwnBusiness(req.user.id);
    if (!biz) return res.status(403).json({ message: "İşletme hesabı gerekli." });

    let code = String(req.body?.code || "").trim().toUpperCase();
    if (code.startsWith(COUPON_PREFIX)) code = code.slice(COUPON_PREFIX.length);
    if (!CODE_RE.test(code)) return res.status(404).json({ message: "Kupon bulunamadı." });

    const coupon = await prisma.loyaltyCoupon.findUnique({ where: { code } });
    if (!coupon || coupon.businessId !== biz.id) {
      return res.status(404).json({ message: "Kupon bulunamadı ya da bu işletmeye ait değil." });
    }
    if (coupon.status !== "active") {
      return res.status(409).json({ message: "Bu kupon daha önce kullanılmış." });
    }

    const done = await prisma.loyaltyCoupon.updateMany({
      where: { id: coupon.id, status: "active" },
      data: { status: "used", usedAt: new Date() },
    });
    if (done.count !== 1) {
      return res.status(409).json({ message: "Bu kupon daha önce kullanılmış." });
    }

    await prisma.loyaltyEvent.create({
      data: {
        programId: coupon.programId,
        businessId: biz.id,
        userId: coupon.userId,
        cashierId: req.user.id,
        kind: "redeem",
        amount: 0,
        delta: 0,
        note: coupon.rewardName,
      },
    });

    res.json({ used: true, rewardName: coupon.rewardName });
  } catch (err) {
    console.error("useCoupon hatası:", err);
    res.status(500).json({ message: "Kupon kullanılamadı" });
  }
};

// GET /api/loyalty/me/events?limit=50
export const listMyEvents = async (req, res) => {
  try {
    const biz = await getOwnBusiness(req.user.id);
    if (!biz) return res.status(403).json({ message: "İşletme hesabı gerekli." });

    const limit = intIn(req.query.limit, 1, 100) || 50;
    const events = await prisma.loyaltyEvent.findMany({
      where: { businessId: biz.id },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    const ids = [...new Set(events.map((e) => e.userId))];
    const users = ids.length
      ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, username: true } })
      : [];
    const names = new Map(users.map((u) => [u.id, maskName(u.username)]));

    res.json({
      events: events.map((e) => ({
        id: e.id,
        kind: e.kind,
        amount: e.amount,
        delta: e.delta,
        note: e.note,
        customer: names.get(e.userId) || "Müşteri",
        createdAt: e.createdAt,
      })),
    });
  } catch (err) {
    console.error("listMyEvents hatası:", err);
    res.status(500).json({ message: "Kayıtlar alınamadı" });
  }
};

// =====================================================================
// MÜŞTERİ
// =====================================================================

// GET /api/loyalty/qr  -> 90 sn geçerli, imzalı müşteri QR'ı
export const getMyQr = async (req, res) => {
  try {
    const token = jwt.sign({ kind: "user", uid: req.user.id }, qrSecret(), {
      expiresIn: QR_TTL_SEC,
    });
    res.json({ qr: `${QR_PREFIX}${token}`, expiresIn: QR_TTL_SEC });
  } catch (err) {
    console.error("getMyQr hatası:", err);
    res.status(500).json({ message: "QR üretilemedi" });
  }
};

// GET /api/loyalty/cards  -> kartlarım + aktif kuponlarım
export const listMyCards = async (req, res) => {
  try {
    const cards = await prisma.loyaltyCard.findMany({
      where: { userId: req.user.id },
      orderBy: { updatedAt: "desc" },
      include: {
        program: {
          include: {
            rewards: true,
            business: { select: { id: true, name: true, logo: true, city: true, district: true } },
          },
        },
      },
    });
    const coupons = await prisma.loyaltyCoupon.findMany({
      where: { userId: req.user.id, status: "active" },
      orderBy: { createdAt: "desc" },
    });

    res.json({
      cards: cards
        .filter((c) => c.program && c.program.business)
        .map((c) => ({
          id: c.id,
          progress: c.progress,
          totalEarned: c.totalEarned,
          program: programDTO(c.program),
          business: c.program.business,
          coupons: coupons.filter((k) => k.cardId === c.id).map(couponDTO),
        })),
    });
  } catch (err) {
    console.error("listMyCards hatası:", err);
    res.status(500).json({ message: "Kartlar alınamadı" });
  }
};

// GET /api/loyalty/coupons/mine  -> aktif + son kullanılan kuponlar
export const listMyCoupons = async (req, res) => {
  try {
    const [active, used] = await Promise.all([
      prisma.loyaltyCoupon.findMany({
        where: { userId: req.user.id, status: "active" },
        orderBy: { createdAt: "desc" },
      }),
      prisma.loyaltyCoupon.findMany({
        where: { userId: req.user.id, status: "used" },
        orderBy: { usedAt: "desc" },
        take: 20,
      }),
    ]);
    res.json({ active: active.map(couponDTO), used: used.map(couponDTO) });
  } catch (err) {
    console.error("listMyCoupons hatası:", err);
    res.status(500).json({ message: "Kuponlar alınamadı" });
  }
};

// POST /api/loyalty/cards/:cardId/claim  { rewardId }  (puan programı)
export const claimReward = async (req, res) => {
  const { cardId } = req.params;
  const rewardId = req.body?.rewardId;
  if (!isObjectId(cardId) || !isObjectId(rewardId)) {
    return res.status(400).json({ message: "Geçersiz istek." });
  }

  try {
    const card = await prisma.loyaltyCard.findUnique({
      where: { id: cardId },
      include: { program: true },
    });
    if (!card || card.userId !== req.user.id) {
      return res.status(404).json({ message: "Kart bulunamadı." });
    }
    if (card.program.type !== "points" || !card.program.isActive) {
      return res.status(400).json({ message: "Bu programda puanla ödül alınamıyor." });
    }
    const reward = await prisma.loyaltyReward.findFirst({
      where: { id: rewardId, programId: card.programId },
    });
    if (!reward) return res.status(404).json({ message: "Ödül bulunamadı." });

    // Atomik düşüm: bakiye yetmezse updateMany hiçbir satırı değiştirmez
    const dec = await prisma.loyaltyCard.updateMany({
      where: { id: card.id, progress: { gte: reward.cost } },
      data: { progress: { decrement: reward.cost } },
    });
    if (dec.count !== 1) {
      return res.status(400).json({ message: "Puanınız bu ödül için yeterli değil." });
    }

    let coupon;
    try {
      [coupon] = await createCoupons({
        card,
        program: card.program,
        count: 1,
        rewardName: reward.name,
        cost: reward.cost,
      });
    } catch (err) {
      // Kupon yazılamadıysa puanı iade et
      await prisma.loyaltyCard.update({
        where: { id: card.id },
        data: { progress: { increment: reward.cost } },
      });
      throw err;
    }

    await prisma.loyaltyEvent.create({
      data: {
        programId: card.programId,
        businessId: card.program.businessId,
        userId: req.user.id,
        cashierId: req.user.id,
        kind: "claim",
        amount: 0,
        delta: reward.cost,
        note: reward.name,
      },
    });

    const after = await prisma.loyaltyCard.findUnique({ where: { id: card.id } });
    res.status(201).json({ coupon: couponDTO(coupon), progress: after.progress });
  } catch (err) {
    console.error("claimReward hatası:", err);
    res.status(500).json({ message: "Ödül alınamadı" });
  }
};

// GET /api/loyalty/business/:businessId  (herkese açık; giriş varsa kartım da gelir)
export const getBusinessProgram = async (req, res) => {
  const { businessId } = req.params;
  if (!isObjectId(businessId)) return res.json({ program: null, card: null });

  try {
    const program = await prisma.loyaltyProgram.findUnique({
      where: { businessId },
      include: { rewards: true },
    });
    if (!program || !program.isActive) return res.json({ program: null, card: null });

    let card = null;
    if (req.user) {
      const c = await prisma.loyaltyCard.findUnique({
        where: { programId_userId: { programId: program.id, userId: req.user.id } },
      });
      if (c) card = { id: c.id, progress: c.progress };
    }
    res.json({ program: programDTO(program), card });
  } catch (err) {
    console.error("getBusinessProgram hatası:", err);
    res.status(500).json({ message: "Program alınamadı" });
  }
};
