// Lien vers le texte du règlement (UE) 2024/1689 sur EUR-Lex, dans la langue de l'interface (§5.2 : chaque
// affirmation est rattachée à un numéro d'article cliquable). EUR-Lex n'expose pas d'ancre stable par article :
// le lien ouvre le règlement. Un seul endroit à modifier quand une version consolidée sera retenue.
export const regulationUrl = (locale: string) =>
  `https://eur-lex.europa.eu/legal-content/${locale === "en" ? "EN" : "FR"}/TXT/?uri=CELEX:32024R1689`;
