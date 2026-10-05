import prisma from "../lib/prisma.js";

// Expo Push Service üzerinden mobil bildirim gönderimi.
// Ek bir paket gerektirmez (Node 18+ yerleşik fetch).
//
// ÖNEMLİ: Buradaki fonksiyonlar asla hata fırlatmaz; bildirim gidemese bile
// asıl işlem (soru, yorum, yanıt) başarılı sayılır.

const EXPO_URL = "https://exp.host/--/api/v2/push/send";
const CHUNK = 100;

export const isExpoToken = (t) =>
  typeof t === "string" && /^Expo(nent)?PushToken\[[^\]]+\]$/.test(t);

const clip = (v = "", n = 140) => {
  const s = String(v).replace(/\s+/g, " ").trim();
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
};

// Token listesine gönderir. { sent, failed } döner; geçersiz cihazları siler.
export async function sendToTokens(tokens, { title, body, data = {} }) {
  const unique = [...new Set((tokens || []).filter(isExpoToken))];
  if (unique.length === 0) return { sent: 0, failed: 0 };

  let sent = 0;
  let failed = 0;
  const dead = [];

  for (let i = 0; i < unique.length; i += CHUNK) {
    const chunk = unique.slice(i, i + CHUNK);
    const messages = chunk.map((to) => ({
      to,
      title: clip(title, 65),
      body: clip(body, 240),
      data,
      sound: "default",
      priority: "high",
      channelId: "default",
    }));

    try {
      const headers = {
        Accept: "application/json",
        "Content-Type": "application/json",
      };
      if (process.env.EXPO_ACCESS_TOKEN) {
        headers.Authorization = `Bearer ${process.env.EXPO_ACCESS_TOKEN}`;
      }
      const res = await fetch(EXPO_URL, {
        method: "POST",
        headers,
        body: JSON.stringify(messages),
      });
      const json = await res.json().catch(() => null);
      const tickets = Array.isArray(json?.data) ? json.data : [];

      if (!res.ok || tickets.length === 0) {
        failed += chunk.length;
        continue;
      }
      tickets.forEach((t, idx) => {
        if (t?.status === "ok") sent += 1;
        else {
          failed += 1;
          if (t?.details?.error === "DeviceNotRegistered") dead.push(chunk[idx]);
        }
      });
    } catch (err) {
      console.error("Expo push gönderilemedi:", err?.message || err);
      failed += chunk.length;
    }
  }

  if (dead.length > 0) {
    prisma.pushToken
      .deleteMany({ where: { token: { in: dead } } })
      .catch((err) => console.error("Eski token temizlenemedi:", err));
  }
  return { sent, failed };
}

// Kullanıcıların tüm cihazlarına gönderir (fire-and-forget).
export function pushToUsers(userIds, payload) {
  const ids = [...new Set((userIds || []).filter(Boolean).map(String))];
  if (ids.length === 0) return Promise.resolve({ sent: 0, failed: 0 });
  return prisma.pushToken
    .findMany({ where: { userId: { in: ids } }, select: { token: true } })
    .then((rows) => sendToTokens(rows.map((r) => r.token), payload))
    .catch((err) => {
      console.error("pushToUsers hatası:", err);
      return { sent: 0, failed: 0 };
    });
}

export const previewText = clip;
