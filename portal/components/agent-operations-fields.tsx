"use client";

import styles from "./agent-intake.module.css";

export type AgentOperations = {
  primaryOffer: string;
  joiningReason: string;
  serviceDays: string[];
  openingTime: string;
  closingTime: string;
  fulfilmentMethods: string[];
  supportChannel: string;
  responseTime: string;
};
export const emptyOperations: AgentOperations = {
  primaryOffer: "",
  joiningReason: "",
  serviceDays: [],
  openingTime: "",
  closingTime: "",
  fulfilmentMethods: [],
  supportChannel: "",
  responseTime: "",
};
export const operationChoices = {
  joiningReason: [
    "Reach more students",
    "Grow my existing business",
    "Offer affordable campus services",
    "Build my teaching experience",
    "Earn from campus deliveries",
  ],
  serviceDays: [
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday",
  ],
  fulfilmentMethods: [
    "Store pickup",
    "Campus delivery",
    "Meet at an agreed location",
    "Online service",
  ],
  supportChannel: ["KampusOne chat", "WhatsApp", "Phone call"],
  responseTime: [
    "Within 15 minutes",
    "Within 1 hour",
    "Within 3 hours",
    "Within 24 hours",
  ],
} as const;

export function validateOperations(
  value: AgentOperations,
): Record<string, string> {
  const errors: Record<string, string> = {};
  if (value.primaryOffer.trim().length < 2)
    errors.primaryOffer = "Tell students what you offer.";
  if (
    !(operationChoices.joiningReason as readonly string[]).includes(
      value.joiningReason,
    )
  )
    errors.joiningReason = "Choose your main reason for joining.";
  if (!value.serviceDays.length)
    errors.serviceDays = "Choose at least one available day.";
  if (
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(value.openingTime) ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(value.closingTime) ||
    value.openingTime === value.closingTime
  )
    errors.serviceHours = "Choose different opening and closing times.";
  if (!value.fulfilmentMethods.length)
    errors.fulfilmentMethods = "Choose how customers receive your service.";
  if (
    !(operationChoices.supportChannel as readonly string[]).includes(
      value.supportChannel,
    )
  )
    errors.supportChannel = "Choose how you help customers.";
  if (
    !(operationChoices.responseTime as readonly string[]).includes(
      value.responseTime,
    )
  )
    errors.responseTime = "Choose your usual response time.";
  return errors;
}

export function AgentOperationsFields({
  value,
  onChange,
  errors = {},
  offerLabel = "What products or services do you offer?",
}: {
  value: AgentOperations;
  onChange(value: AgentOperations): void;
  errors?: Record<string, string>;
  offerLabel?: string;
}) {
  const update = (key: keyof AgentOperations, answer: string | string[]) =>
    onChange({ ...value, [key]: answer });
  const error = (key: string) =>
    errors[key] ? (
      <span className="field-error" role="alert">
        {errors[key]}
      </span>
    ) : null;
  const multi = (key: "serviceDays" | "fulfilmentMethods", label: string) => (
    <fieldset className={styles.optionField}>
      <legend>{label}</legend>
      <div className={styles.chipOptions}>
        {operationChoices[key].map((choice) => (
          <label
            key={choice}
            className={
              value[key].includes(choice) ? styles.selectedChip : styles.chip
            }
          >
            <input
              type="checkbox"
              checked={value[key].includes(choice)}
              onChange={(event) =>
                update(
                  key,
                  event.target.checked
                    ? [...value[key], choice]
                    : value[key].filter((item) => item !== choice),
                )
              }
            />
            {choice}
          </label>
        ))}
      </div>
      {error(key)}
    </fieldset>
  );
  const select = (
    key: "joiningReason" | "supportChannel" | "responseTime",
    label: string,
  ) => (
    <label>
      {label}
      <select
        value={value[key]}
        aria-invalid={Boolean(errors[key])}
        onChange={(event) => update(key, event.target.value)}
      >
        <option value="">Choose an option</option>
        {operationChoices[key].map((choice) => (
          <option key={choice}>{choice}</option>
        ))}
      </select>
      {error(key)}
    </label>
  );
  return (
    <div className={styles.operations}>
      <label>
        {offerLabel}
        <input
          value={value.primaryOffer}
          maxLength={200}
          placeholder="e.g. Fresh meals, groceries or printing"
          onChange={(event) => update("primaryOffer", event.target.value)}
          aria-invalid={Boolean(errors.primaryOffer)}
        />
        {error("primaryOffer")}
      </label>
      {select("joiningReason", "What brings you to KampusOne?")}
      {multi("serviceDays", "When are you available?")}
      <fieldset className={styles.optionField}>
        <legend>Service hours</legend>
        <div className={styles.hours}>
          <label>
            From
            <input
              type="time"
              value={value.openingTime}
              onChange={(event) => update("openingTime", event.target.value)}
            />
          </label>
          <label>
            To
            <input
              type="time"
              value={value.closingTime}
              onChange={(event) => update("closingTime", event.target.value)}
            />
          </label>
        </div>
        <small className="field-help">
          Times use your campus local time. A closing time before opening means
          overnight service.
        </small>
        {error("serviceHours")}
      </fieldset>
      {multi("fulfilmentMethods", "How will customers receive your service?")}
      <div className={styles.twoColumns}>
        {select("supportChannel", "Customer support")}
        {select("responseTime", "Usual response time")}
      </div>
    </div>
  );
}
