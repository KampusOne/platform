/** Lightweight search vocabulary shared by native discovery and the API. */
export const learningTypeLabels: Record<string, string> = {
  PDF: 'pdf pdfs document documents book books material materials',
  NOTE: 'note notes document documents material materials',
  PAST_QUESTION: 'past question questions paper papers pdf pdfs document documents material materials',
  VIDEO: 'video videos lesson lessons material materials',
  AUDIOBOOK: 'audio audios audiobook audiobooks material materials',
};
export function learningSearchTerms(query: string) {
  return query.trim().toLowerCase().slice(0, 120).split(/\s+/).filter(Boolean).slice(0, 10);
}
export function matchesLearningSearch(item: {
  title?: string; description?: string; course_code?: string; publisher_name?: string;
  tutor_name?: string; resource_type?: string; subject?: string; parts?: { title: string }[];
}, query: string) {
  const document = [item.title, item.description, item.course_code, item.publisher_name, item.tutor_name, item.subject,
    item.resource_type ? learningTypeLabels[item.resource_type] ?? item.resource_type : 'tutor tutors tutorial tutorials',
    (item.parts?.length ?? 0) > 1 ? 'playlist playlists playbook playbooks collection collections' : '',
    ...(item.parts ?? []).map(p => p.title),
  ].filter(Boolean).join(' ').toLowerCase();
  return learningSearchTerms(query).every(term => document.includes(term));
}
