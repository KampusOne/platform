import { sql } from "drizzle-orm";
import { database, firstRow } from "./database";
import { AppError } from "./errors";
import { ageOn } from "./platform-policy";
import type { Bindings } from "../types";
export async function requireFullKyc(env: Bindings, applicationId: string) {
  const row = firstRow(
    await database(env).execute<{
      birth_date: string;
      guardian_consent_at: string | null;
      guardian_reviewed_by: string | null;
      bank_status: string;
      kyc_status: string;
      documents: number;
      user_id: string;
      is_student: boolean;
      verified_person: boolean;
      phone_verified_at: string | null;
      terms_accepted_at: string | null;
    }>(
      sql`select d.birth_date::text,d.guardian_consent_at,d.guardian_reviewed_by,a.bank_status,a.kyc_status,a.user_id,d.is_student,a.phone_verified_at,a.terms_accepted_at,exists(select 1 from app_private.verified_people v where v.user_id=a.user_id) verified_person,(select count(*)::int from public.media_objects m where m.owner_user_id=a.user_id and m.deleted_at is null and m.kind='kyc' and m.id in(d.identity_document_id,d.portrait_document_id,case when d.is_student then d.student_document_id else null end)) documents from public.agent_applications a join public.agent_application_details d on d.application_id=a.id where a.id=${applicationId}::uuid`,
    ),
  );
  if (
    !row ||
    ageOn(row.birth_date) < 16 ||
    row.documents !== (row.is_student ? 3 : 2) ||
    !row.verified_person ||
    !row.phone_verified_at ||
    !row.terms_accepted_at ||
    !["VERIFIED", "MANUALLY_VERIFIED"].includes(row.kyc_status) ||
    row.bank_status !== "VERIFIED"
  )
    throw new AppError(
      409,
      "KYC_REQUIRED",
      "Complete identity, document and bank verification first.",
    );
  if (
    ageOn(row.birth_date) < 18 &&
    (!row.guardian_consent_at || !row.guardian_reviewed_by)
  )
    throw new AppError(
      409,
      "GUARDIAN_REQUIRED",
      "Guardian approval must be verified before activating this account.",
    );
  return row;
}
