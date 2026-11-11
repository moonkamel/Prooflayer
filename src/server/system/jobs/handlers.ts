// Registre des types de jobs de l'application. Chaque ticket qui ajoute un traitement différé y enregistre son
// type (« github.backfill », « control.evaluate », « seal.org », « pack.build »… §4.3.2). Vide à PL-107.
import { JobRegistry } from "./registry";

export const jobRegistry = new JobRegistry();
