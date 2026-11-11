-- PL-201 : la qualification d'une modification de conception porte sa date et son motif (§5.3, écran B :
-- « qualifier une modification de conception (significative ou non, avec motif) »).
ALTER TABLE "DesignChange" ADD COLUMN "qualifiedAt" TIMESTAMP(3);
ALTER TABLE "DesignChange" ADD COLUMN "qualificationReason" TEXT;
