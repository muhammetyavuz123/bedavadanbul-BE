import { data } from "../data/il-ilce.js";

export const getCities = async (req, res) => {
  console.log("🚀 ~ getCities ~ req:", req);
  const query = req.query;
  try {
    const iller = data.map((il) => ({
      il_adi: il.il_adi,
      //   plaka_kodu: il.plaka_kodu.trim(),
    }));
    res.status(200).json(iller);
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Failed to get citiest" });
  }
};

export const getDistrich = async (req, res) => {
  const ilAdi = req.params.ilAdi.toLowerCase();

  try {
    const il = data.find((i) => i.il_adi.toLowerCase() === ilAdi);

    if (!il) {
      return res.status(404).json({ hata: "İl bulunamadı" });
    }

    const ilceler = il.ilceler.map((ilce) => ({
      ilce_adi: ilce.ilce_adi,
    }));
    res.status(200).json(ilceler);
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Failed to get districh" });
  }
};
