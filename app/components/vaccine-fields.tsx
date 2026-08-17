"use client";

import { useRef, useState } from "react";
import { BrazilianDateInput } from "@/app/components/brazilian-date-input";

export type VaccineRecord = { name: string; expiresOn: string };

const vaccineSuggestions = ["V10", "V8", "Antirrábica", "Giárdia", "Gripe"];

type VaccineDraft = VaccineRecord & { key: string };

export function vaccinesFromFormData(form: FormData): VaccineRecord[] {
  const names = form.getAll("vaccineName").map((value) => String(value).trim());
  const dates = form.getAll("vaccineExpiresOn").map((value) => String(value));
  return names
    .map((name, index) => ({ name, expiresOn: dates[index] ?? "" }))
    .filter((vaccine) => vaccine.name || vaccine.expiresOn);
}

export function VaccineFields({
  initialVaccines = [],
  idPrefix,
}: {
  initialVaccines?: VaccineRecord[];
  idPrefix: string;
}) {
  const sequence = useRef(initialVaccines.length);
  const [vaccines, setVaccines] = useState<VaccineDraft[]>(() =>
    (initialVaccines.length ? initialVaccines : [{ name: "", expiresOn: "" }]).map(
      (vaccine, index) => ({ ...vaccine, key: `${idPrefix}-${index}` }),
    ),
  );
  const suggestionsId = `${idPrefix}-vaccine-suggestions`;

  function update(key: string, values: Partial<VaccineRecord>) {
    setVaccines((current) =>
      current.map((vaccine) =>
        vaccine.key === key ? { ...vaccine, ...values } : vaccine,
      ),
    );
  }

  function remove(key: string) {
    setVaccines((current) => {
      const next = current.filter((vaccine) => vaccine.key !== key);
      return next.length
        ? next
        : [{ key: `${idPrefix}-empty-${sequence.current++}`, name: "", expiresOn: "" }];
    });
  }

  return (
    <fieldset className="vaccine-editor">
      <legend>Vacinas</legend>
      <p>Registre cada vacina separadamente com sua data de vencimento.</p>
      <datalist id={suggestionsId}>
        {vaccineSuggestions.map((suggestion) => (
          <option value={suggestion} key={suggestion} />
        ))}
      </datalist>
      <div className="vaccine-editor-list">
        {vaccines.map((vaccine, index) => (
          <div className="vaccine-editor-row" key={vaccine.key}>
            <label className="field">
              <span>Vacina {index + 1}</span>
              <input
                name="vaccineName"
                value={vaccine.name}
                list={suggestionsId}
                maxLength={120}
                placeholder="Ex.: V10"
                onChange={(event) => update(vaccine.key, { name: event.target.value })}
              />
            </label>
            <label className="field">
              <span>Vencimento</span>
              <BrazilianDateInput
                name="vaccineExpiresOn"
                value={vaccine.expiresOn}
                ariaLabel={`Vencimento da vacina ${index + 1}`}
                onChange={(expiresOn) => update(vaccine.key, { expiresOn })}
              />
            </label>
            <button
              type="button"
              className="vaccine-remove-button"
              aria-label={`Remover vacina ${index + 1}`}
              onClick={() => remove(vaccine.key)}
            >
              Remover
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        className="secondary-button vaccine-add-button"
        onClick={() =>
          setVaccines((current) => [
            ...current,
            {
              key: `${idPrefix}-new-${sequence.current++}`,
              name: "",
              expiresOn: "",
            },
          ])
        }
      >
        + Adicionar vacina
      </button>
    </fieldset>
  );
}
