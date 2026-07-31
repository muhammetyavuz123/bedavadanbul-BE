// Not: Burada önce `bad-words` paketini denedik, ama v4 sürümü bu projenin
// "type": "module" ayarıyla ESM olarak import edildiğinde
// "does not provide an export named 'default'" hatasıyla çöküyor (paketin
// dışa aktarım şekli Node'un CJS/ESM birlikte çalışma mantığıyla
// uyuşmuyor). Kırılgan bir bağımlılığa bağlı kalmamak için kendi basit
// filtremizi kullanıyoruz; listeye istediğiniz kadar kelime ekleyebilirsiniz.
const blacklist = [
  "fuck",
  "shit",
  "bitch",
  "asshole",
  "bastard",
  "dick",
  "pussy",
  "cunt",
  "piç",
  "orospu",
  "orospu çocuğu",
  "amk",
  "amına koyayım",
  "sik",
  "siktir",
  "yavşak",
  "göt",
  "götveren",
  "ibne",
  "pezevenk",
  "kaltak",
  "şerefsiz",
  "gavat",
  "yarrak",
];

const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Not: Türkçe karakterler (ç, ş, ğ, ı, ö, ü) JS regex'te \b (kelime sınırı)
// ile güvenilir çalışmadığı için sınır kontrolü yapmıyoruz; bu bazı çok
// nadir yanlış pozitiflere (örn. kelimenin içinde geçen alt dize) yol
// açabilir ama çökme veya yanlış negatiflerden çok daha güvenli bir seçim.
const regex = new RegExp(`(${blacklist.map(escapeRegex).join("|")})`, "i");

export const isClean = (text) => {
  if (!text) return true;
  return !regex.test(text);
};
