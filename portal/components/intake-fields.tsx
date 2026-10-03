"use client";

import { useState } from "react";

const countries = [
  { code: "+234", name: "Nigeria" },
  { code: "+233", name: "Ghana" },
  { code: "+229", name: "Benin" },
  { code: "+237", name: "Cameroon" },
  { code: "+44", name: "United Kingdom" },
  { code: "+1", name: "United States / Canada" },
] as const;

export function PhoneField({
  id,
  label,
  value,
  error,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  error?: string;
  onChange: (value: string) => void;
}) {
  const selected =
    countries.find(({ code }) => value.startsWith(code)) ?? countries[0];
  const national = value.startsWith(selected.code)
    ? value.slice(selected.code.length)
    : value.replace(/^0/, "");

  return (
    <label htmlFor={id}>
      {label}
      <span className="phone-input">
        <select
          aria-label={`${label} country code`}
          value={selected.code}
          onChange={(event) =>
            onChange(event.target.value + national.replace(/^0/, ""))
          }
        >
          {countries.map(({ code, name }) => (
            <option
              key={code}
              value={code}
              aria-label={`${name} ${code}`}
              title={name}
            >
              {code}
            </option>
          ))}
        </select>
        <input
          id={id}
          type="tel"
          inputMode="numeric"
          autoComplete="tel-national"
          value={national}
          placeholder={
            selected.code === "+234" ? "801 234 5678" : "Phone number"
          }
          maxLength={14}
          aria-invalid={Boolean(error)}
          onChange={(event) =>
            onChange(
              selected.code +
                event.target.value.replace(/\D/g, "").replace(/^0/, ""),
            )
          }
        />
      </span>
      {error ? (
        <span className="field-error" role="alert">
          {error}
        </span>
      ) : null}
    </label>
  );
}

export function BirthDateField({
  value,
  onChange,
  error,
  minAge = 16,
}: {
  value: string;
  onChange: (value: string) => void;
  error?: string;
  minAge?: number;
}) {
  const [draftParts, setParts] = useState(value.split("-"));
  const parts = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? value.split("-")
    : draftParts;
  const change = (index: number, next: string) => {
    const result = [...parts];
    result[index] = next;
    setParts(result);
    onChange(result[0] && result[1] && result[2] ? result.join("-") : "");
  };
  const year = new Date().getFullYear();

  return (
    <fieldset className="date-fields">
      <legend>Date of birth</legend>
      <div>
        {[
          [
            2,
            "Day",
            Array.from({ length: 31 }, (_, i) =>
              String(i + 1).padStart(2, "0"),
            ),
          ],
          [
            1,
            "Month",
            Array.from({ length: 12 }, (_, i) =>
              String(i + 1).padStart(2, "0"),
            ),
          ],
          [
            0,
            "Year",
            Array.from({ length: 111 - minAge }, (_, i) =>
              String(year - minAge - i),
            ),
          ],
        ].map(([index, label, options]) => (
          <select
            key={String(label)}
            aria-label={`Birth ${label}`}
            value={parts[Number(index)] ?? ""}
            onChange={(event) => change(Number(index), event.target.value)}
            required
          >
            <option value="">{String(label)}</option>
            {(options as string[]).map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        ))}
      </div>
      {error ? (
        <span className="field-error" role="alert">
          {error}
        </span>
      ) : null}
    </fieldset>
  );
}
