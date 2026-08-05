"use client";

import { useMemo, useState } from "react";

const MONTHS = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];
const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

function parseIso(value: string | null | undefined) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? "");
  if (!match) return null;
  const date = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
  );
  return date.toISOString().slice(0, 10) === value ? date : null;
}

function isoFromDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function parseBrazilianDate(value: string) {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());
  if (!match) return null;
  const date = new Date(
    Date.UTC(Number(match[3]), Number(match[2]) - 1, Number(match[1])),
  );
  return isoFromDate(date) === `${match[3]}-${match[2]}-${match[1]}`
    ? isoFromDate(date)
    : null;
}

export function formatBrazilianDate(value: string | null | undefined) {
  if (!value) return "";
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(value)) return value;
  const timestamp = new Date(value);
  if (!Number.isNaN(timestamp.valueOf())) {
    return new Intl.DateTimeFormat("pt-BR", {
      timeZone: "America/Sao_Paulo",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(timestamp);
  }
  return value;
}

function monthStart(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1));
}

function shiftMonth(value: Date, amount: number) {
  return new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + amount, 1),
  );
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
  const [draft, setDraft] = useState(() => ({
    forValue: value ?? defaultValue,
    text: formatBrazilianDate(value ?? defaultValue),
  }));
  const [open, setOpen] = useState(false);
  const currentValue = value ?? internalValue;
  const selectedDate = parseIso(currentValue);
  const [visibleMonth, setVisibleMonth] = useState(
    monthStart(selectedDate ?? new Date()),
  );

  const typedValue =
    draft.forValue === currentValue
      ? draft.text
      : formatBrazilianDate(currentValue);

  const days = useMemo(() => {
    const first = monthStart(visibleMonth);
    const offset = first.getUTCDay();
    const lastDay = new Date(
      Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0),
    ).getUTCDate();
    return [
      ...Array.from({ length: offset }, () => null),
      ...Array.from({ length: lastDay }, (_, index) =>
        new Date(
          Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), index + 1),
        ),
      ),
    ];
  }, [visibleMonth]);

  function commit(nextValue: string) {
    if (value === undefined) setInternalValue(nextValue);
    onChange?.(nextValue);
  }

  function acceptTypedValue() {
    const trimmed = typedValue.trim();
    if (!trimmed) {
      commit("");
      return;
    }
    const iso = parseBrazilianDate(trimmed);
    if (iso && (!min || iso >= min) && (!max || iso <= max)) {
      commit(iso);
      return;
    }
    setDraft({
      forValue: currentValue,
      text: formatBrazilianDate(currentValue),
    });
  }

  function chooseDate(date: Date) {
    const nextValue = isoFromDate(date);
    commit(nextValue);
    setDraft({ forValue: nextValue, text: formatBrazilianDate(nextValue) });
    setOpen(false);
  }

  return (
    <span className="brazilian-date-input">
      {name && <input name={name} type="hidden" value={currentValue} />}
      <input
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder="dd/mm/aaaa"
        value={typedValue}
        required={required}
        autoFocus={autoFocus}
        aria-label={ariaLabel}
        onChange={(event) =>
          setDraft({ forValue: currentValue, text: event.target.value })
        }
        onBlur={acceptTypedValue}
      />
      <button
        type="button"
        className="date-calendar-button"
        aria-label="Abrir calendário"
        aria-expanded={open}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          if (!open && selectedDate) setVisibleMonth(monthStart(selectedDate));
          setOpen((current) => !current);
        }}
      >
        ▣
      </button>
      {open && (
        <span className="date-picker-popover" role="dialog" aria-label="Calendário">
          <span className="date-picker-header">
            <button
              type="button"
              aria-label="Mês anterior"
              onClick={() => setVisibleMonth((month) => shiftMonth(month, -1))}
            >
              ‹
            </button>
            <strong>
              {MONTHS[visibleMonth.getUTCMonth()]} {visibleMonth.getUTCFullYear()}
            </strong>
            <button
              type="button"
              aria-label="Próximo mês"
              onClick={() => setVisibleMonth((month) => shiftMonth(month, 1))}
            >
              ›
            </button>
          </span>
          <span className="date-picker-grid">
            {WEEKDAYS.map((weekday) => (
              <span className="date-picker-weekday" key={weekday}>
                {weekday}
              </span>
            ))}
            {days.map((date, index) => {
              if (!date) return <span key={`empty-${index}`} />;
              const dateValue = isoFromDate(date);
              const disabled =
                Boolean(min && dateValue < min) || Boolean(max && dateValue > max);
              return (
                <button
                  type="button"
                  key={dateValue}
                  className={dateValue === currentValue ? "selected" : ""}
                  disabled={disabled}
                  onClick={() => chooseDate(date)}
                >
                  {date.getUTCDate()}
                </button>
              );
            })}
          </span>
        </span>
      )}
    </span>
  );
}
