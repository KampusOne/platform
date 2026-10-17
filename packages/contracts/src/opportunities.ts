export const opportunityTypes = ['INTERNSHIP', 'SCHOLARSHIP', 'GRANT', 'STUDENT_LOAN', 'SPONSORSHIP', 'SKILL_ACQUISITION', 'FELLOWSHIP', 'COMPETITION', 'OTHER'] as const;
export const opportunityLabels: Record<typeof opportunityTypes[number], string> = {
  INTERNSHIP: 'Internship', SCHOLARSHIP: 'Scholarship', GRANT: 'Grant', STUDENT_LOAN: 'Student loan',
  SPONSORSHIP: 'Sponsorship', SKILL_ACQUISITION: 'Skill acquisition', FELLOWSHIP: 'Fellowship', COMPETITION: 'Competition', OTHER: 'Other opportunity',
};
