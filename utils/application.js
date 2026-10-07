import prisma from "../lib/prisma.js";
import { data as ilIlceData } from "../data/il-ilce.js";
import { notifyUsers } from "./notify.js";
import {
  notifyAdminNewApplication,
  notifyOwnerApplicationApproved,
  notifyOwnerApplicationRejected,
} from "./mailer.js";

// İşletme başvuru akışı için ortak yardımcılar (kayıt + işletme + yönetici).
//
// Akış: işyeri hesabı açılınca işletme kaydı "pending" (onay bekliyor) ve
// isActive=false olarak oluşur → herkese açık hiçbir listede görünmez.
// Yönetici onaylayınca status="approved", isActive=true olur.
// Eski kayıtlarda `status` alanı yoktur; boş (null) = onaylı sayılır.

export const isObjectId = (v) => typeof v === "string" && /^[a-f\d]{24}$/i.test(v);

// İşletme kategorisi = sitedeki mevcut (onaylı + aktif) kategoriler; ana ya da alt
// kategori seçilebilir.
export const findUsableCategory = (id) =>
  isObjectId(id)
    ? prisma.category.findFirst({
        where: { id, isApproved: true, isActive: true },
        select: { id: true },
      })
    : null;

export const isValidLocation = (city, district) => {
  const il = ilIlceData.find((i) => i.il_adi === city);
  if (!il) return false;
  return il.ilceler.some((i) => i.ilce_adi === district);
};

// Eski kayıtlarda alan yoksa "approved" kabul edilir.
export const statusOf = (business) => (business && business.status) || "approved";

// Tüm yöneticilere: yeni (ya da yeniden gönderilen) başvuru var.
// Asla hata fırlatmaz.
export const notifyAdminsOfApplication = async (business, ownerEmail, resubmitted = false) => {
  try {
    const admins = await prisma.user.findMany({
      where: { role: "admin" },
      select: { id: true, email: true },
    });
    if (admins.length === 0) return;

    notifyUsers(
      admins.map((a) => a.id),
      {
        title: resubmitted ? "İşletme başvurusu yeniden gönderildi" : "Yeni işletme başvurusu",
        body: `${business.name} · ${business.district}, ${business.city}`,
        kind: "application",
        refId: business.id,
      },
    );
    for (const a of admins) {
      notifyAdminNewApplication({
        to: a.email,
        businessName: business.name,
        city: business.city,
        district: business.district,
        ownerEmail,
      });
    }
  } catch (err) {
    console.error("Yöneticiye başvuru bildirimi gönderilemedi:", err);
  }
};

// Başvuru sahibine: onaylandı / reddedildi. Asla hata fırlatmaz.
export const notifyApplicant = async (business, decision, reason = "") => {
  try {
    const owner = await prisma.user.findUnique({
      where: { id: business.ownerId },
      select: { id: true, email: true },
    });
    if (!owner) return;

    if (decision === "approved") {
      notifyUsers([owner.id], {
        title: "Başvurun onaylandı",
        body: `${business.name} artık herkese açık. Logo, fotoğraf ve açıklamanı ekleyerek profilini tamamla.`,
        kind: "business",
        refId: business.id,
      });
      notifyOwnerApplicationApproved({
        to: owner.email,
        businessName: business.name,
        businessId: business.id,
      });
    } else {
      notifyUsers([owner.id], {
        title: "Başvurun onaylanmadı",
        body: reason ? `Gerekçe: ${reason}` : `${business.name} başvurusu onaylanmadı.`,
        kind: "business",
        refId: business.id,
      });
      notifyOwnerApplicationRejected({
        to: owner.email,
        businessName: business.name,
        reason,
      });
    }
  } catch (err) {
    console.error("Başvuru sahibine bildirim gönderilemedi:", err);
  }
};
