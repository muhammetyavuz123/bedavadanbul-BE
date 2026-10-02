import nodemailer from "nodemailer";

// İşletme bildirimleri için e-posta. auth.controller.js'teki SMTP ayarlarını
// (SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS) kullanır.
//
// ÖNEMLİ: Bu fonksiyonlar asla hata fırlatmaz ve çağıran taraf onları
// beklemez (fire-and-forget). Mail gidemese bile soru/yorum işlemi başarılı
// sayılır.

let transporter = null;
const getTransporter = () => {
  if (transporter) return transporter;
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
    return null;
  }
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  return transporter;
};

export const clientUrl = (path = "") => {
  const base = (process.env.CLIENT_URL || "https://bedavadanbul.com").replace(/\/+$/, "");
  return `${base}${path}`;
};

const esc = (v = "") =>
  String(v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const layout = ({ title, body, ctaText, ctaUrl }) => `
<div style="font-family:Arial,Helvetica,sans-serif;background:#f6f7fb;padding:24px">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;border:1px solid #eceef5">
    <div style="background:linear-gradient(135deg,#ff3c38,#ff6a3d);padding:18px 24px;color:#fff;font-size:18px;font-weight:700">BedavadanBul</div>
    <div style="padding:24px;color:#1c1f2e;font-size:15px;line-height:1.6">
      <h2 style="margin:0 0 12px;font-size:18px">${esc(title)}</h2>
      ${body}
      ${
        ctaUrl
          ? `<p style="margin:24px 0 0"><a href="${esc(ctaUrl)}" style="display:inline-block;background:#ff3c38;color:#fff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:10px">${esc(ctaText)}</a></p>`
          : ""
      }
    </div>
    <div style="padding:14px 24px;background:#fafbfd;color:#8a8fa3;font-size:12px">
      Bu e-posta BedavadanBul işletme bildirimi olarak gönderildi.
    </div>
  </div>
</div>`;

const quote = (t) =>
  `<blockquote style="margin:12px 0;padding:10px 14px;background:#f6f7fb;border-left:3px solid #ff3c38;border-radius:6px;color:#444">${esc(
    String(t).slice(0, 300),
  )}${String(t).length > 300 ? "…" : ""}</blockquote>`;

const send = (to, subject, html) => {
  if (!to) return;
  const t = getTransporter();
  if (!t) return;
  t.sendMail({
    from: `"BedavadanBul" <${process.env.SMTP_USER}>`,
    to,
    subject,
    html,
  }).catch((err) => console.error("Mail gönderilemedi:", err?.message || err));
};

// İşletme sahibine: yeni soru geldi
export const notifyOwnerNewInquiry = ({ to, businessName, subject, message }) =>
  send(
    to,
    `Yeni müşteri sorusu: ${subject}`.slice(0, 120),
    layout({
      title: `${businessName} için yeni bir soru aldınız`,
      body: `<p><strong>${esc(subject)}</strong></p>${quote(message)}<p>Soruyu yalnızca siz görebilirsiniz. Hızlı yanıt vermek müşterinin güvenini artırır.</p>`,
      ctaText: "Soruyu yanıtla",
      ctaUrl: clientUrl("/profile?tab=business"),
    }),
  );

// İşletme sahibine: konuşmada yeni müşteri mesajı
export const notifyOwnerNewMessage = ({ to, businessName, subject, message }) =>
  send(
    to,
    `Yeni mesaj: ${subject}`.slice(0, 120),
    layout({
      title: `${businessName} – konuşmada yeni mesaj var`,
      body: `<p><strong>${esc(subject)}</strong></p>${quote(message)}`,
      ctaText: "Konuşmayı aç",
      ctaUrl: clientUrl("/profile?tab=business"),
    }),
  );

// Müşteriye: işletme yanıt verdi
export const notifyCustomerReply = ({ to, businessName, subject, message }) =>
  send(
    to,
    `${businessName} sorunuzu yanıtladı`.slice(0, 120),
    layout({
      title: `${businessName} sorunuzu yanıtladı`,
      body: `<p><strong>${esc(subject)}</strong></p>${quote(message)}`,
      ctaText: "Yanıtı gör",
      ctaUrl: clientUrl("/sorularim"),
    }),
  );

// İşletme sahibine: yeni yorum
export const notifyOwnerNewReview = ({ to, businessName, businessId, rating, comment }) =>
  send(
    to,
    `${businessName} için yeni ${rating} yıldızlık yorum`,
    layout({
      title: `${businessName} yeni bir yorum aldı`,
      body: `<p>Puan: <strong>${"★".repeat(rating)}${"☆".repeat(5 - rating)}</strong></p>${
        comment ? quote(comment) : ""
      }<p>Yoruma herkese açık bir yanıt yazabilirsiniz.</p>`,
      ctaText: "Yoruma yanıt ver",
      ctaUrl: clientUrl(`/isletme/${businessId}#reviews`),
    }),
  );

// Müşteriye: işletme yorumuna yanıt verdi
export const notifyReviewerReply = ({ to, businessName, businessId, reply }) =>
  send(
    to,
    `${businessName} yorumunuza yanıt verdi`.slice(0, 120),
    layout({
      title: `${businessName} yorumunuza yanıt verdi`,
      body: quote(reply),
      ctaText: "Yanıtı gör",
      ctaUrl: clientUrl(`/isletme/${businessId}#reviews`),
    }),
  );
