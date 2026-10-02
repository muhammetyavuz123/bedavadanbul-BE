// prisma/seedCategories.js
//
// Kategori iskeletini (ana kategoriler + en bilinen alt kategoriler) tek
// seferlik olarak veritabanına eklemek için. Amaç: kullanıcıyı boş bir
// kategori listesiyle karşılamamak, ama onlarca nadiren kullanılan alt
// kategoriyle de boğmamak. Kullanıcılar zaten category.controller.js'teki
// createCategory ile kendi (moderasyonlu) alt kategorilerini
// önerebiliyor — bu script sadece sağlam bir başlangıç omurgası kuruyor.
//
// Çalıştırma: api/ klasöründe  ->  npm run seed
// (Script tekrar tekrar çalıştırılabilir: slug'ı zaten var olan kategorileri
// atlar, sadece eksik olanları ekler.)

import prisma from "../lib/prisma.js";

// ⚠️ NOT: category.controller.js'teki createCategory, slug'ı
// `name.toLowerCase().trim().replace(/\s+/g, "-")` ile üretiyor — Türkçe
// büyük/küçük harf dönüşümünü (İ/ı, Ş/ş, vb.) doğru yapmıyor ve "&" gibi
// karakterleri temizlemiyor. Kullanıcıların formdan girdiği isimler için bu
// script o mantığı değiştirmiyor (tutarlılık için), ama BURADA, sistem
// tarafından baştan eklenen sabit kategoriler için daha temiz URL'ler
// istediğimizden düzgün bir transliterasyon kullanıyoruz.
function toSlug(name) {
  const trMap = {
    İ: "i", I: "i", ı: "i", Ş: "s", ş: "s",
    Ğ: "g", ğ: "g", Ü: "u", ü: "u", Ö: "o", ö: "o", Ç: "c", ç: "c",
  };
  return name
    .split("")
    .map((ch) => trMap[ch] ?? ch)
    .join("")
    .toLowerCase()
    .trim()
    .replace(/&/g, "ve")
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

// Ana kategori + en bilinen alt kategoriler (4-5 tane / ana kategori).
// İsim listesini burada değiştirip script'i tekrar çalıştırman yeterli —
// yeni eklenenler işlenir, zaten var olanlar atlanır.
const CATEGORY_TREE = [
  {
    name: "Giyim & Aksesuar",
    children: ["Kadın Giyim", "Erkek Giyim", "Ayakkabı", "Çanta & Aksesuar", "Çocuk Giyim"],
  },
  {
    name: "Elektronik",
    children: ["Telefon", "Bilgisayar & Tablet", "Küçük Ev Aletleri", "Oyun & Konsol", "TV & Ses Sistemleri"],
  },
  {
    name: "Ev & Yaşam",
    children: ["Mobilya", "Ev Dekorasyon", "Temizlik Ürünleri", "Bahçe & Yapı Market", "Ev Tekstili"],
  },
  {
    name: "Yemek & İçecek",
    children: ["Restoran", "Kafe", "Market & Manav", "Fast Food", "Pastane & Tatlı"],
  },
  {
    name: "Sağlık & Güzellik",
    children: ["Kozmetik", "Kişisel Bakım", "Spa & Wellness", "Eczane & Vitamin", "Diyetisyen & Sağlık"],
  },
  {
    name: "Seyahat & Tatil",
    children: ["Otel & Tatil Köyü", "Uçak Bileti", "Tur Paketleri", "Araç Kiralama", "Yurt Dışı Seyahat"],
  },
  {
    name: "Eğitim & Kurslar",
    children: ["Dil Kursu", "Sürücü Kursu", "Kitap & Kırtasiye", "Online Eğitim", "Özel Ders"],
  },
  {
    name: "Otomotiv",
    children: ["Yedek Parça", "Bakım & Servis", "Lastik & Jant", "Araç Yıkama", "Sigorta & Kasko"],
  },
  {
    name: "Spor & Outdoor",
    children: ["Spor Giyim", "Fitness & Spor Salonu", "Outdoor Ekipman", "Bisiklet", "Spor Malzemeleri"],
  },
  {
    name: "Hizmetler",
    children: ["Kuaför & Berber", "Temizlik Hizmeti", "Onarım & Tadilat", "Fotoğrafçılık", "Nakliyat"],
  },
  {
    name: "Eğlence & Etkinlik",
    children: ["Sinema & Tiyatro", "Konser & Festival", "Oyun Parkı", "Escape Room", "Bilet & Etkinlik"],
  },
  {
    name: "Anne & Bebek",
    children: ["Bebek Ürünleri", "Oyuncak", "Anne Bakımı", "Bebek Giyim", "Bebek Arabası & Ekipman"],
  },
];

async function upsertCategory(name, parentId) {
  const slug = toSlug(name);

  // ⚠️ createCategory'deki aynı mantık: slug @unique olsa da MongoDB'de bu
  // index her ortamda garanti uygulanmış olmayabilir, o yüzden elle de
  // kontrol ediyoruz — aksi halde script'i ikinci kez çalıştırınca
  // kategoriler ikişer ikişer oluşabilir.
  const existing = await prisma.category.findFirst({ where: { slug } });
  if (existing) {
    console.log(`⏭  Zaten var, atlandı: ${name}`);
    return existing;
  }

  const created = await prisma.category.create({
    data: {
      name,
      slug,
      parentId: parentId || null,
      isActive: true,
      isApproved: true, // sistem/admin kaydı — onay beklemeden direkt görünür
      createdBy: "admin",
    },
  });
  console.log(`✅ Eklendi: ${name}${parentId ? "" : "  (ana kategori)"}`);
  return created;
}

async function main() {
  for (const mainCat of CATEGORY_TREE) {
    const parent = await upsertCategory(mainCat.name, null);
    for (const childName of mainCat.children) {
      await upsertCategory(childName, parent.id);
    }
  }
}

main()
  .catch((e) => {
    console.error("Seed sırasında hata:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
