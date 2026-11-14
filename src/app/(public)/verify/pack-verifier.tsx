"use client";

// Vérification d'un pack dans le navigateur (PL-508). Le fichier est lu localement (File API) et passé à verifyPack ;
// aucune requête ne le transporte. Résultat : verdict en clair, identité du pack, six étapes avec leur explication et
// leurs anomalies (textes du paquet @prooflayer/verify, dans la langue de la page), horodatages, rapport JSON.
import { useId, useRef, useState, type DragEvent } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { CircleCheck, CircleHelp, CircleX, ShieldCheck, TriangleAlert, Upload } from "lucide-react";
import { MESSAGES, summaryLine, verifyPack, type VerifyReport } from "@prooflayer/verify";
import type { VerificationTrust } from "@/server/services/public-verification";
import { STATUS_STYLES } from "@/components/status-badge";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

type StepStatus = VerifyReport["steps"][number]["status"];
const STEP_STYLE: Record<StepStatus, (typeof STATUS_STYLES)[keyof typeof STATUS_STYLES]> = {
  pass: STATUS_STYLES.PASS,
  warning: STATUS_STYLES.PARTIAL,
  fail: STATUS_STYLES.FAIL,
  skipped: STATUS_STYLES.MISSING,
};
const STEP_ICON = { pass: CircleCheck, warning: TriangleAlert, fail: CircleX, skipped: CircleHelp };

export function PackVerifier({ trust, locale }: { trust: VerificationTrust; locale: "fr" | "en" }) {
  const t = useTranslations("publicVerify");
  const format = useFormatter();
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<
    | { kind: "idle" }
    | { kind: "busy"; name: string }
    | { kind: "error"; message: string }
    | { kind: "done"; name: string; report: VerifyReport }
  >({ kind: "idle" });
  const [over, setOver] = useState(false);

  async function check(file: File | undefined) {
    if (!file) return;
    if (!/\.zip$/iu.test(file.name)) {
      setState({ kind: "error", message: t("notZip") });
      return;
    }
    setState({ kind: "busy", name: file.name });
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const report = await verifyPack(bytes, trust);
      setState({ kind: "done", name: file.name, report });
    } catch {
      setState({ kind: "error", message: t("unreadable") });
    }
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    void check(e.dataTransfer.files[0]);
  };
  const day = (iso: string) => {
    const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
    return Number.isNaN(d.getTime())
      ? iso
      : format.dateTime(d, { dateStyle: "long", timeZone: "UTC" });
  };
  const reset = () => {
    setState({ kind: "idle" });
    if (input.current) input.current.value = "";
  };

  if (state.kind === "done") {
    const { report } = state;
    const issues = MESSAGES[locale].issues;
    const verdict = report.ok ? (report.clean ? "ok" : "okWithWarnings") : "fail";
    const style = STEP_STYLE[verdict === "ok" ? "pass" : verdict === "fail" ? "fail" : "warning"];
    const Icon = verdict === "ok" ? ShieldCheck : verdict === "fail" ? CircleX : TriangleAlert;
    const json = `data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(report, null, 2))}`;
    return (
      <div className="space-y-6" data-testid="verify-result" data-verdict={verdict}>
        <section
          role="status"
          aria-labelledby="verdict"
          className="space-y-2 rounded-lg border-2 p-5"
          style={{ background: style.bg, borderColor: style.border, color: style.fg }}
        >
          <h2 id="verdict" className="flex items-center gap-2 text-xl" style={{ color: style.fg }}>
            <Icon aria-hidden="true" className="size-6 shrink-0" />
            {t(`verdict.${verdict}`)}
          </h2>
          <p>{t(`verdictText.${verdict}`)}</p>
          <p className="font-medium" data-testid="verify-summary">
            {summaryLine(report, locale)}
          </p>
        </section>
        {report.pack && (
          <p className="text-sm text-muted-foreground">
            {t("pack", {
              system: report.pack.system.name,
              organization: report.pack.organization.name,
              start: day(report.pack.period.start),
              end: day(report.pack.period.end),
            })}
            {report.pack.signingKid && <> {t("signedBy", { kid: report.pack.signingKid })}</>}
          </p>
        )}
        <section aria-labelledby="steps-title" className="space-y-3">
          <h2 id="steps-title">{t("stepsTitle")}</h2>
          <ol className="list-decimal space-y-3 pl-6 marker:font-medium">
            {report.steps.map((step) => {
              const s = STEP_STYLE[step.status];
              const StepIcon = STEP_ICON[step.status];
              return (
                <li
                  key={step.id}
                  data-testid="verify-step"
                  data-status={step.status}
                  className="rounded-md border border-border p-4"
                >
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    <span>{t(`steps.${step.id}.title`)}</span>
                    <span
                      className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs"
                      style={{ color: s.fg, background: s.bg, borderColor: s.border }}
                    >
                      <StepIcon aria-hidden="true" className="size-3.5" />
                      {t(`status.${step.status}`)}
                    </span>
                  </p>
                  <p className="text-sm text-muted-foreground">{t(`steps.${step.id}.what`)}</p>
                  {step.issues.length > 0 && (
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
                      {step.issues.map((issue, i) => (
                        <li key={i}>{issues[issue.code](issue.params)}</li>
                      ))}
                      {step.issueCount > step.issues.length && (
                        <li>{t("more", { count: step.issueCount - step.issues.length })}</li>
                      )}
                    </ul>
                  )}
                </li>
              );
            })}
          </ol>
        </section>
        {report.summary.timestamps.length > 0 && (
          <ul className="space-y-1 text-sm">
            {report.summary.timestamps.map((ts) => (
              <li key={ts.anchor}>
                {t("timestamp", { anchor: ts.anchor, date: day(ts.genTime), tsa: ts.tsa })} ·{" "}
                {t(ts.qualified ? "qualified" : "notQualified")}
              </li>
            ))}
          </ul>
        )}
        <p className="text-sm">{t("proves")}</p>
        <div className="flex flex-wrap items-center gap-4">
          <Button type="button" onClick={reset}>
            {t("again")}
          </Button>
          <a href={json} download={`${state.name.replace(/\.zip$/iu, "")}-verification.json`}>
            {t("downloadReport")}
          </a>
        </div>
        <p className="text-xs text-muted-foreground">{t("cli")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="flex items-start gap-2 rounded-md border border-border bg-muted p-3 text-sm">
        <ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        {t("privacy")}
      </p>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        data-testid="drop-zone"
        className={`flex flex-col items-center gap-3 rounded-lg border-2 border-dashed p-8 text-center ${
          over ? "border-primary bg-muted" : "border-border"
        }`}
      >
        <Upload aria-hidden="true" className="size-8 text-muted-foreground" />
        <p className="font-medium">{t("drop")}</p>
        <label htmlFor={inputId} className="cursor-pointer text-link underline">
          {t("choose")}
          <span className="sr-only"> · {t("fileLabel")}</span>
        </label>
        <input
          ref={input}
          id={inputId}
          type="file"
          accept=".zip,application/zip"
          className="sr-only"
          disabled={state.kind === "busy"}
          onChange={(e) => void check(e.target.files?.[0])}
        />
      </div>
      {state.kind === "busy" && <Alert>{t("verifying", { name: state.name })}</Alert>}
      {state.kind === "error" && <Alert tone="error">{state.message}</Alert>}
    </div>
  );
}
