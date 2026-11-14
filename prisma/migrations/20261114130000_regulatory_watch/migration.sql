-- PL-603 : fil de veille réglementaire. Les entrées (table système RegulatoryUpdate, §4.3) sont publiées depuis un
-- fichier versionné ; `notifiedAt` marque l'entrée dont les administrateurs ont été prévenus, une seule fois.
ALTER TABLE "RegulatoryUpdate" ADD COLUMN "notifiedAt" TIMESTAMP(3);
