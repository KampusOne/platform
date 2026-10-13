"use client";
import { useState } from 'react';
/** The audit note records the explicit checkbox decision, without mandatory prose. */
export function DecisionConsent({ name, label = "I reviewed this record and confirm the selected action.", value, onChange, disabled = false }: {
    name?: string;
    label?: string;
    value?: string;
    onChange?: (value: string) => void;
    disabled?: boolean;
}) {
    const [local, setLocal] = useState(false), checked = onChange ? Boolean(value) : local;
    const audit = "Reviewer explicitly confirmed: " + label;
    return <span className="checkbox" style={{ display: 'flex', gap: 10, alignItems: 'center' }}><input type="checkbox" required aria-label={label} disabled={disabled} checked={checked} onChange={e => { setLocal(e.target.checked); onChange?.(e.target.checked ? audit : ''); }}/><span>{label}</span>{name ? <input type="hidden" name={name} value={checked ? audit : ''}/> : null}</span>;
}
