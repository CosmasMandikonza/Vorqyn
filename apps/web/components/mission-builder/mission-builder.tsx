"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  budgetOf,
  FIELD_STEPS,
  LIMITS,
  stepErrors,
  validate,
  type DraftInput,
  type Errors,
} from "@/lib/workspace-draft/schema";
import {
  MACHINE_LABELS,
  MODALITIES,
  OBJECTIVES,
  SENSORS,
  TEMPLATE_ID,
  TEMPLATE_NAME,
  ZONES,
  requiredModalities,
} from "@/lib/workspace-draft/metadata";
import { useDrafts } from "./use-drafts";
import styles from "./builder.module.css";

const STEPS = [
  "Objective",
  "Environment",
  "Capabilities",
  "Evidence & budget",
  "Review & save",
];
export function MissionBuilder() {
  const d = useDrafts();
  const [errors, setErrors] = useState<Errors>({});
  const heading = useRef<HTMLHeadingElement>(null);
  const active = d.editor;
  const input = active?.input;
  const activeId = active?.id,
    activeStep = active?.step;
  useEffect(() => {
    if (activeId) heading.current?.focus();
    setErrors({});
  }, [activeId, activeStep]);
  function invalid(next: Errors) {
    setErrors(next);
    requestAnimationFrame(() => {
      const first = Object.keys(next)[0];
      if (first) document.getElementById(`draft-${first}`)?.focus();
    });
  }
  function change<K extends keyof DraftInput>(field: K, value: DraftInput[K]) {
    if (!input) return;
    d.update({ ...input, [field]: value });
    setErrors((current) => {
      const copy = { ...current };
      delete copy[field];
      return copy;
    });
  }
  function next() {
    if (!active) return;
    const found = stepErrors(active.input, active.step);
    if (Object.keys(found).length) {
      invalid(found);
      return;
    }
    d.move(active.step + 1);
  }
  function save() {
    if (!active) return;
    const found = validate(active.input);
    if (Object.keys(found).length) {
      const step = FIELD_STEPS[Object.keys(found)[0]!] ?? 0;
      d.move(step);
      requestAnimationFrame(() => invalid(found));
      return;
    }
    void d.persist(true);
  }
  function error(field: string) {
    return errors[field] ? (
      <p id={`error-${field}`} className={styles.fieldError}>
        {errors[field]}
      </p>
    ) : null;
  }
  const fieldProps = (field: string) => ({
    id: `draft-${field}`,
    "aria-invalid": !!errors[field],
    "aria-describedby": `${field}-help${errors[field] ? ` error-${field}` : ""}`,
  });
  return (
    <div className={styles.layout}>
      <aside className={styles.library} aria-labelledby="local-list-title">
        <div className={styles.libraryHeading}>
          <h2 id="local-list-title">In this browser</h2>
          <span className="mono">
            {d.records.length}/{LIMITS.records}
          </span>
        </div>
        <Button
          onClick={() => {
            setErrors({});
            d.start();
          }}
          disabled={
            !d.ready ||
            d.records.length >= LIMITS.records ||
            (!!d.problem && ["corrupt", "version"].includes(d.problem.kind))
          }
        >
          New local draft <span aria-hidden="true">+</span>
        </Button>
        <p className={styles.hint}>
          Progress autosaves. Final save requires a valid review. Browser data
          can be cleared or lost.
        </p>
        {!d.ready ? (
          <p role="status">Reading this browser’s drafts…</p>
        ) : d.records.length === 0 ? (
          <p className={styles.noDrafts}>
            No local drafts yet.
            <br />
            Start with a mission brief.
          </p>
        ) : (
          <ul className={styles.draftList}>
            {[...d.records]
              .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
              .map((record) => (
                <li key={record.id} data-active={record.id === active?.id}>
                  <button
                    type="button"
                    className={styles.openDraft}
                    onClick={() => d.open(record)}
                    aria-current={record.id === active?.id ? "true" : undefined}
                  >
                    <strong>
                      {record.input.title.trim() || "Untitled draft"}
                    </strong>
                    <span>
                      {record.complete ? "Reviewed · Saved" : "In progress"} ·{" "}
                      {record.input.budgetSol || "No budget"}
                      {record.input.budgetSol ? " SOL" : ""}
                    </span>
                  </button>
                  <button
                    className={styles.deleteDraft}
                    type="button"
                    aria-label={`Delete ${record.input.title.trim() || "Untitled draft"}`}
                    onClick={() => void d.remove(record)}
                  >
                    Delete
                  </button>
                </li>
              ))}
          </ul>
        )}
      </aside>
      <section className={styles.editor} aria-label="Mission draft editor">
        <p role="status" aria-live="polite" className={styles.saveStatus}>
          {d.message}
        </p>
        {d.problem && (
          <div role="alert" className={styles.problem}>
            <h2>
              {["corrupt", "version"].includes(d.problem.kind)
                ? "Draft storage needs attention"
                : "Changes have not been saved"}
            </h2>
            <p>{d.problem.message}</p>
            {["corrupt", "version"].includes(d.problem.kind) ? (
              <Button variant="secondary" onClick={() => void d.reset()}>
                Reset unreadable local drafts
              </Button>
            ) : d.problem.kind === "storage" ? (
              <Button variant="secondary" onClick={d.retry}>
                Retry browser storage
              </Button>
            ) : null}
          </div>
        )}
        {d.conflict && (
          <div role="alert" className={styles.problem}>
            <h2>A newer browser copy exists.</h2>
            <p>
              This draft changed or was deleted in another tab. Your open
              changes are preserved, and saving is paused.
            </p>
            <div className="cta-row">
              <Button variant="secondary" onClick={d.reloadCopy}>
                Load browser copy
              </Button>
              <Button onClick={d.copy}>Keep changes as new draft</Button>
            </div>
          </div>
        )}
        {!active || !input ? (
          <div className={styles.intro}>
            <p className="eyebrow">Before the machines move</p>
            <h2>
              A mission begins
              <br />
              with a better question.
            </h2>
            <p>
              Choose an objective. Define the regions. Specify the evidence.
              Every draft keeps its own identity, settings and proposed budget.
            </p>
            <div className={styles.briefDiagram} aria-hidden="true">
              <span>Objective</span>
              <span>Place</span>
              <span>Proof</span>
            </div>
          </div>
        ) : (
          <>
            <div className={styles.draftIdentity}>
              <span className="mono">LOCAL / {active.id}</span>
              <Button variant="quiet" onClick={d.close}>
                Close draft
              </Button>
            </div>
            <ol className={styles.steps} aria-label="Draft steps">
              {STEPS.map((name, index) => (
                <li key={name}>
                  <button
                    type="button"
                    disabled={index > active.step}
                    aria-current={index === active.step ? "step" : undefined}
                    onClick={() => d.move(index)}
                  >
                    <span className="mono">0{index + 1}</span>
                    <span>{name}</span>
                  </button>
                </li>
              ))}
            </ol>
            <form
              noValidate
              onSubmit={(event) => {
                event.preventDefault();
                if (active.step === 4) save();
                else next();
              }}
              className={styles.form}
            >
              <div className={styles.stepHeading}>
                <p className="eyebrow">Step 0{active.step + 1} / 05</p>
                <h2 ref={heading} tabIndex={-1}>
                  {STEPS[active.step]}
                </h2>
              </div>
              {!!Object.keys(errors).length && (
                <p role="alert" className={styles.errorSummary}>
                  Review the marked fields. Your inputs are still here.
                </p>
              )}
              {active.step === 0 && (
                <>
                  <div className={styles.field}>
                    <label htmlFor="draft-title">
                      Mission title <span>Required</span>
                    </label>
                    <p id="title-help">
                      A short fictional name, up to 80 characters. No private or
                      customer information.
                    </p>
                    <input
                      {...fieldProps("title")}
                      maxLength={80}
                      autoComplete="off"
                      value={input.title}
                      onChange={(e) => change("title", e.target.value)}
                      required
                      placeholder="e.g. Pier B access survey"
                    />
                    {error("title")}
                  </div>
                  <div className={styles.field}>
                    <label htmlFor="draft-template">Supported template</label>
                    <p id="template-help">
                      One fictional port world is available. Selecting it does
                      not create a mission or start a simulation.
                    </p>
                    <select
                      {...fieldProps("template")}
                      value={input.templateId}
                      onChange={(e) => change("templateId", e.target.value)}
                    >
                      <option value={TEMPLATE_ID}>{TEMPLATE_NAME}</option>
                    </select>
                    {error("template")}
                  </div>
                  <div className={styles.field}>
                    <label htmlFor="draft-objective">
                      Inspection objective <span>Required</span>
                    </label>
                    <p id="objective-help">
                      The objective determines which regions and capabilities
                      are compatible.
                    </p>
                    <select
                      {...fieldProps("objective")}
                      value={input.objective}
                      onChange={(e) => change("objective", e.target.value)}
                    >
                      {OBJECTIVES.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                    {error("objective")}
                  </div>
                </>
              )}
              {active.step === 1 && (
                <fieldset
                  className={styles.fieldset}
                  id="draft-zones"
                  tabIndex={-1}
                  aria-describedby={`zones-help${errors.zones ? " error-zones" : ""}`}
                >
                  <legend>
                    Inspection regions <span>Required</span>
                  </legend>
                  <p id="zones-help">
                    Select actual named regions from the fictional port
                    metadata. Height is relative to the waterline. A damaged
                    region is an inspection target, not a safe access route.
                  </p>
                  {error("zones")}
                  {MODALITIES.map((modality) => (
                    <div key={modality} className={styles.zoneGroup}>
                      <h3>{MACHINE_LABELS[modality]}</h3>
                      {ZONES.filter((z) => z.modality === modality).map(
                        (zone) => (
                          <label key={zone.id} className={styles.checkRow}>
                            <input
                              type="checkbox"
                              checked={input.zoneIds.includes(zone.id)}
                              onChange={(e) =>
                                change(
                                  "zoneIds",
                                  e.target.checked
                                    ? [...input.zoneIds, zone.id]
                                    : input.zoneIds.filter(
                                        (id) => id !== zone.id,
                                      ),
                                )
                              }
                            />
                            <span>
                              <strong>{zone.label}</strong>
                              <small>{zone.description}</small>
                            </span>
                          </label>
                        ),
                      )}
                    </div>
                  ))}
                </fieldset>
              )}
              {active.step === 2 && (
                <fieldset
                  className={styles.fieldset}
                  id="draft-machines"
                  tabIndex={-1}
                  aria-describedby={`machines-help${errors.machines ? " error-machines" : ""}`}
                >
                  <legend>Proposed machine requirements</legend>
                  <p id="machines-help">
                    These are planning requirements, not registered operators or
                    available fleet equipment. Sensor choices are product
                    planning options; the world metadata supplies only regions
                    and vehicle classes.
                  </p>
                  {error("machines")}
                  {requiredModalities(input.zoneIds).map((modality) => (
                    <div className={styles.zoneGroup} key={modality}>
                      <h3>{MACHINE_LABELS[modality]}</h3>
                      <p className={styles.hint}>
                        {modality === "land"
                          ? "Route mapping is required for ground access."
                          : modality === "water"
                            ? "The evidence method must match an ROV sensor. Sonar is required for the submerged obstruction objective."
                            : "A survey camera is required for aerial inspection."}
                      </p>
                      {SENSORS[modality].map((sensor) => (
                        <label className={styles.checkRow} key={sensor.id}>
                          <input
                            type="checkbox"
                            checked={input.sensors[modality].includes(
                              sensor.id,
                            )}
                            onChange={(e) =>
                              change("sensors", {
                                ...input.sensors,
                                [modality]: e.target.checked
                                  ? [...input.sensors[modality], sensor.id]
                                  : input.sensors[modality].filter(
                                      (id) => id !== sensor.id,
                                    ),
                              })
                            }
                          />
                          <span>{sensor.label}</span>
                        </label>
                      ))}
                    </div>
                  ))}
                </fieldset>
              )}
              {active.step === 3 && (
                <>
                  <p className={styles.hint}>
                    Proposed acceptance thresholds describe a future verifier
                    policy. They are not measured coverage, evidence quality or
                    physical safety certification.
                  </p>
                  <div className={styles.fieldPair}>
                    {(["minCoverage", "minQuality"] as const).map((field) => (
                      <div className={styles.field} key={field}>
                        <label htmlFor={`draft-${field}`}>
                          {field === "minCoverage"
                            ? "Minimum coverage (%)"
                            : "Minimum evidence quality (%)"}
                        </label>
                        <p id={`${field}-help`}>
                          Whole percentage, 1–100.{" "}
                          {field === "minCoverage"
                            ? "Required portion of the selected inspection regions."
                            : "Required quality threshold for the future evidence policy."}
                        </p>
                        <input
                          {...fieldProps(field)}
                          inputMode="numeric"
                          value={input[field]}
                          onChange={(e) => change(field, e.target.value)}
                          required
                          maxLength={3}
                        />
                        {error(field)}
                      </div>
                    ))}
                  </div>
                  {requiredModalities(input.zoneIds).includes("water") && (
                    <div className={styles.field}>
                      <label htmlFor="draft-waterEvidence">
                        Underwater evidence method
                      </label>
                      <p id="waterEvidence-help">
                        Sonar supports obstruction mapping in low visibility.
                        Optical inspection needs clear visibility; neither
                        certifies structural integrity.
                      </p>
                      <select
                        {...fieldProps("waterEvidence")}
                        value={input.waterEvidence}
                        onChange={(e) =>
                          change("waterEvidence", e.target.value)
                        }
                      >
                        <option value="sonar">Sonar obstruction mapping</option>
                        <option value="optical">Optical inspection</option>
                      </select>
                      {error("waterEvidence")}
                    </div>
                  )}
                  <div className={styles.field}>
                    <label htmlFor="draft-budgetSol">
                      Proposed budget (SOL) <span>Required</span>
                    </label>
                    <p id="budgetSol-help">
                      More than 0, up to 1,000,000 SOL; at most 9 decimal
                      places. Stored as exact integer lamports. No wallet
                      transfer occurs.
                    </p>
                    <input
                      {...fieldProps("budgetSol")}
                      inputMode="decimal"
                      autoComplete="off"
                      value={input.budgetSol}
                      onChange={(e) => change("budgetSol", e.target.value)}
                      required
                      maxLength={32}
                      placeholder="e.g. 2.000000001"
                    />
                    {error("budgetSol")}
                  </div>
                </>
              )}
              {active.step === 4 && (
                <div className={styles.review}>
                  <Badge>Review the local brief</Badge>
                  <h3>{input.title}</h3>
                  <dl>
                    {[
                      [
                        "Objective",
                        OBJECTIVES.find((o) => o.id === input.objective)?.label,
                        0,
                      ],
                      ["Template", TEMPLATE_NAME, 0],
                      [
                        "Regions",
                        ZONES.filter((z) => input.zoneIds.includes(z.id))
                          .map((z) => z.label)
                          .join("; "),
                        1,
                      ],
                      [
                        "Capabilities",
                        requiredModalities(input.zoneIds)
                          .map(
                            (m) =>
                              `${MACHINE_LABELS[m]}: ${input.sensors[m].map((id) => SENSORS[m].find((s) => s.id === id)?.label).join(", ")}`,
                          )
                          .join("; "),
                        2,
                      ],
                      [
                        "Acceptance",
                        `${input.minCoverage}% minimum coverage · ${input.minQuality}% minimum quality${requiredModalities(input.zoneIds).includes("water") ? ` · ${input.waterEvidence} underwater evidence` : ""}`,
                        3,
                      ],
                      [
                        "Proposed budget",
                        `${input.budgetSol} SOL · ${budgetOf(input) ?? "Invalid amount"} lamports`,
                        3,
                      ],
                    ].map(([label, value, step]) => (
                      <div key={label}>
                        <dt>{label}</dt>
                        <dd>
                          {value}
                          <button
                            type="button"
                            className={styles.editLink}
                            onClick={() => d.move(step as number)}
                          >
                            Edit {label}
                          </button>
                        </dd>
                      </div>
                    ))}
                  </dl>
                  <p className={styles.hint}>
                    Saving keeps a local planning record. It does not authorize
                    work, register an operator, fund escrow or launch a mission.
                  </p>
                </div>
              )}
              <div className={styles.formActions}>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={active.step === 0}
                  onClick={() => d.move(active.step - 1)}
                >
                  Back
                </Button>
                {active.step === 4 ? (
                  <Button
                    type="submit"
                    disabled={d.busy || d.conflict || !!d.problem}
                  >
                    Save local draft
                  </Button>
                ) : (
                  <Button type="submit">
                    Continue <span aria-hidden="true" className="arrow-icon" />
                  </Button>
                )}
              </div>
            </form>
          </>
        )}
      </section>
    </div>
  );
}
