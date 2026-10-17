/** Storage keys are identifiers, not lesson names. Preserve the tutor's readable title. */
export function learningTitle(value: string | null | undefined, fallback = 'Learning material') {
  const text = (value ?? '').trim().replace(/\.(pdf|mp4|mov|m4v|mp3|m4a|wav)$/i, '').replace(/_pdf$/i, '');
  if (!text || /^[a-f\d-]{24,}$/i.test(text)) return fallback;
  return text.replace(/[_]+/g, ' ').replace(/([a-z])-(?=[a-z])/gi, '$1 ').replace(/\s+/g, ' ').trim();
}
