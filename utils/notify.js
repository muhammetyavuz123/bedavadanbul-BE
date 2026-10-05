import prisma from "../lib/prisma.js";
import { pushToUsers, previewText } from "./push.js";

export { previewText };

// Uygulama içi bildirim kutusuna yazar. İstenirse (cihaz kaydı varsa) ayrıca
// telefon bildirimi de gider; Firebase/APNs kurulmadıysa bu ikinci adım
// sessizce hiçbir şey yapmaz.
//
// ÖNEMLİ: Asla hata fırlatmaz, çağıran taraf beklemez (fire-and-forget).
const CHUNK = 1000;

export async function notifyUsers(userIds, { title, body, kind = "general", refId = null, screen = null }) {
  const ids = [...new Set((userIds || []).filter(Boolean).map(String))];
  if (ids.length === 0) return { users: 0 };

  try {
    for (let i = 0; i < ids.length; i += CHUNK) {
      await prisma.userNotification.createMany({
        data: ids.slice(i, i + CHUNK).map((userId) => ({
          userId,
          title: previewText(title, 80),
          body: previewText(body, 240),
          kind,
          refId,
          screen,
        })),
      });
    }
  } catch (err) {
    console.error("Bildirim kutusuna yazılamadı:", err);
  }

  // Telefon bildirimi (varsa)
  pushToUsers(ids, {
    title,
    body,
    data: { kind, ...(refId ? { refId } : {}), ...(screen ? { screen } : {}) },
  });

  return { users: ids.length };
}
