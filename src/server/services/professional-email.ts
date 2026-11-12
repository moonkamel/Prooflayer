// Adresse professionnelle (PL-208, §7.2 : « note PDF contre une adresse email professionnelle »). Fonction pure : une
// adresse de messagerie grand public est refusée. La liste couvre les principaux fournisseurs en France et en Europe.
export const PERSONAL_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "yahoo.fr",
  "ymail.com",
  "hotmail.com",
  "hotmail.fr",
  "outlook.com",
  "outlook.fr",
  "live.com",
  "live.fr",
  "msn.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "aol.fr",
  "orange.fr",
  "wanadoo.fr",
  "free.fr",
  "sfr.fr",
  "neuf.fr",
  "laposte.net",
  "bbox.fr",
  "numericable.fr",
  "gmx.com",
  "gmx.fr",
  "gmx.de",
  "gmx.net",
  "web.de",
  "t-online.de",
  "proton.me",
  "protonmail.com",
  "pm.me",
  "tutanota.com",
  "tuta.io",
  "yandex.com",
  "yandex.ru",
  "mail.com",
  "mail.ru",
  "zoho.com",
  "libero.it",
  "virgilio.it",
  "seznam.cz",
  "wp.pl",
  "o2.pl",
]);

const EMAIL = /^[^\s@]+@([a-z0-9-]+\.)+[a-z]{2,}$/u;

export function emailDomain(email: string): string {
  return email.trim().toLowerCase().split("@")[1] ?? "";
}

export function isProfessionalEmail(email: string): boolean {
  const normalized = email.trim().toLowerCase();
  if (!EMAIL.test(normalized)) return false;
  return !PERSONAL_EMAIL_DOMAINS.has(emailDomain(normalized));
}
