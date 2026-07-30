"use client";

import { useState } from "react";

export function formatBrazilianDate(value: string | null | undefined) {
  if (!value) return "";
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(value)) return value;
  return value;
}

export function BrazilianDateInput({
  name,
  value,
  defaultValue = "",
  min,
  max,
  required,
  autoFocus,
  onChange,
  ariaLabel,
}: {
  name?: string;
  value?: string;
  defaultValue?: string;
  min?: string;
  max?: string;
  required?: boolean;
  autoFocus?: boolean;
  onChange?: (value: string) => void;
  ariaLabel?: string;
}) {
  const [internalValue, setInternalValue] = useState(defaultValue);
  const currentValue = value ?? internalValue;

  return (
    <span className="brazilian-date-input">
      <span aria-hidden="true">
        {formatBrazilianDate(currentValue) || "dd/mm/aaaa"}
      </span>
      <span className="date-calendar-mark" aria-hidden="true">
        ▣
      </span>
      <input
        name={name}
        type="date"
        value={currentValue}
        min={min}
        max={max}
        required={required}
        autoFocus={autoFocus}
        aria-label={ariaLabel}
        onChange={(event) => {
          const nextValue = event.target.value;
          if (value === undefined) setInternalValue(nextValue);
          onChange?.(nextValue);
        }}
      />
    </span>
  );
}
