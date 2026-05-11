const blacklist = ["fuck", "shit", "bitch", "piç", "orospu", "amk", "sik"];

const regex = new RegExp(`\\b(${blacklist.join("|")})\\b`, "i");

export const isClean = (text) => {
  if (!text) return true;
  return !regex.test(text);
};
