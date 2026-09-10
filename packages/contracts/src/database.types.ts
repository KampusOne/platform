export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      academic_terms: {
        Row: {
          code: string
          created_at: string
          ends_on: string
          id: string
          institution_id: string
          name: string
          starts_on: string
          status: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          ends_on: string
          id?: string
          institution_id: string
          name: string
          starts_on: string
          status?: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          ends_on?: string
          id?: string
          institution_id?: string
          name?: string
          starts_on?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "academic_terms_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_application_documents: {
        Row: {
          application_id: string
          checked_at: string | null
          created_at: string
          extracted_name: string | null
          id: string
          institution_id: string
          kind: string
          mime_type: string
          name_match_score: number | null
          object_path: string
          original_filename: string
          sha256: string | null
          size_bytes: number
          updated_at: string
          upload_status: string
          verification_status: string
        }
        Insert: {
          application_id: string
          checked_at?: string | null
          created_at?: string
          extracted_name?: string | null
          id?: string
          institution_id: string
          kind: string
          mime_type: string
          name_match_score?: number | null
          object_path: string
          original_filename: string
          sha256?: string | null
          size_bytes: number
          updated_at?: string
          upload_status?: string
          verification_status?: string
        }
        Update: {
          application_id?: string
          checked_at?: string | null
          created_at?: string
          extracted_name?: string | null
          id?: string
          institution_id?: string
          kind?: string
          mime_type?: string
          name_match_score?: number | null
          object_path?: string
          original_filename?: string
          sha256?: string | null
          size_bytes?: number
          updated_at?: string
          upload_status?: string
          verification_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_application_documents_institution_id_application_id_fkey"
            columns: ["institution_id", "application_id"]
            isOneToOne: false
            referencedRelation: "agent_applications"
            referencedColumns: ["institution_id", "id"]
          },
        ]
      }
      agent_applications: {
        Row: {
          applicant_type: string
          applicant_user_id: string
          created_at: string
          current_level: number | null
          desired_roles: string[]
          email: string
          full_name: string
          id: string
          institution_id: string
          last_reviewed_at: string | null
          matriculation_number: string | null
          phone: string
          programme: string | null
          statement: string
          status: string
          status_reason: string | null
          submitted_at: string | null
          updated_at: string
        }
        Insert: {
          applicant_type: string
          applicant_user_id: string
          created_at?: string
          current_level?: number | null
          desired_roles: string[]
          email: string
          full_name: string
          id?: string
          institution_id: string
          last_reviewed_at?: string | null
          matriculation_number?: string | null
          phone: string
          programme?: string | null
          statement: string
          status?: string
          status_reason?: string | null
          submitted_at?: string | null
          updated_at?: string
        }
        Update: {
          applicant_type?: string
          applicant_user_id?: string
          created_at?: string
          current_level?: number | null
          desired_roles?: string[]
          email?: string
          full_name?: string
          id?: string
          institution_id?: string
          last_reviewed_at?: string | null
          matriculation_number?: string | null
          phone?: string
          programme?: string | null
          statement?: string
          status?: string
          status_reason?: string | null
          submitted_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_applications_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
        ]
      }
      campuses: {
        Row: {
          created_at: string
          id: string
          institution_id: string
          is_primary: boolean
          locality: string | null
          name: string
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          institution_id: string
          is_primary?: boolean
          locality?: string | null
          name: string
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          institution_id?: string
          is_primary?: boolean
          locality?: string | null
          name?: string
          slug?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "campuses_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
        ]
      }
      course_enrollments: {
        Row: {
          created_at: string
          id: string
          institution_id: string
          offering_id: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          institution_id: string
          offering_id: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          institution_id?: string
          offering_id?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "course_enrollments_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "course_enrollments_institution_id_offering_id_fkey"
            columns: ["institution_id", "offering_id"]
            isOneToOne: false
            referencedRelation: "course_offerings"
            referencedColumns: ["institution_id", "id"]
          },
        ]
      }
      course_offerings: {
        Row: {
          course_id: string
          created_at: string
          id: string
          institution_id: string
          section: string
          status: string
          term_id: string
          updated_at: string
        }
        Insert: {
          course_id: string
          created_at?: string
          id?: string
          institution_id: string
          section?: string
          status?: string
          term_id: string
          updated_at?: string
        }
        Update: {
          course_id?: string
          created_at?: string
          id?: string
          institution_id?: string
          section?: string
          status?: string
          term_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "course_offerings_institution_id_course_id_fkey"
            columns: ["institution_id", "course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["institution_id", "id"]
          },
          {
            foreignKeyName: "course_offerings_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "course_offerings_institution_id_term_id_fkey"
            columns: ["institution_id", "term_id"]
            isOneToOne: false
            referencedRelation: "academic_terms"
            referencedColumns: ["institution_id", "id"]
          },
        ]
      }
      courses: {
        Row: {
          code: string
          created_at: string
          department_id: string
          id: string
          institution_id: string
          status: string
          title: string
          units: number
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          department_id: string
          id?: string
          institution_id: string
          status?: string
          title: string
          units: number
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          department_id?: string
          id?: string
          institution_id?: string
          status?: string
          title?: string
          units?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "courses_institution_id_department_id_fkey"
            columns: ["institution_id", "department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["institution_id", "id"]
          },
          {
            foreignKeyName: "courses_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
        ]
      }
      departments: {
        Row: {
          code: string
          created_at: string
          faculty_id: string
          id: string
          institution_id: string
          name: string
          status: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          faculty_id: string
          id?: string
          institution_id: string
          name: string
          status?: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          faculty_id?: string
          id?: string
          institution_id?: string
          name?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "departments_institution_id_faculty_id_fkey"
            columns: ["institution_id", "faculty_id"]
            isOneToOne: false
            referencedRelation: "faculties"
            referencedColumns: ["institution_id", "id"]
          },
          {
            foreignKeyName: "departments_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
        ]
      }
      faculties: {
        Row: {
          code: string
          created_at: string
          id: string
          institution_id: string
          name: string
          status: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          institution_id: string
          name: string
          status?: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          institution_id?: string
          name?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "faculties_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
        ]
      }
      feature_flags: {
        Row: {
          client_visible: boolean
          configuration: Json
          created_at: string
          enabled: boolean
          id: string
          institution_id: string | null
          key: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          client_visible?: boolean
          configuration?: Json
          created_at?: string
          enabled?: boolean
          id?: string
          institution_id?: string | null
          key: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          client_visible?: boolean
          configuration?: Json
          created_at?: string
          enabled?: boolean
          id?: string
          institution_id?: string | null
          key?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "feature_flags_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
        ]
      }
      institution_memberships: {
        Row: {
          created_at: string
          id: string
          institution_id: string
          member_type: string
          status: string
          updated_at: string
          user_id: string
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          institution_id: string
          member_type: string
          status?: string
          updated_at?: string
          user_id: string
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          institution_id?: string
          member_type?: string
          status?: string
          updated_at?: string
          user_id?: string
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "institution_memberships_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
        ]
      }
      institutions: {
        Row: {
          country_code: string
          created_at: string
          id: string
          name: string
          short_name: string
          slug: string
          status: string
          timezone: string
          updated_at: string
        }
        Insert: {
          country_code?: string
          created_at?: string
          id?: string
          name: string
          short_name: string
          slug: string
          status?: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          country_code?: string
          created_at?: string
          id?: string
          name?: string
          short_name?: string
          slug?: string
          status?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          active_institution_id: string | null
          avatar_path: string | null
          created_at: string
          display_name: string
          id: string
          updated_at: string
        }
        Insert: {
          active_institution_id?: string | null
          avatar_path?: string | null
          created_at?: string
          display_name?: string
          id: string
          updated_at?: string
        }
        Update: {
          active_institution_id?: string | null
          avatar_path?: string | null
          created_at?: string
          display_name?: string
          id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_active_institution_id_fkey"
            columns: ["active_institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
        ]
      }
      programmes: {
        Row: {
          award: string
          code: string
          created_at: string
          department_id: string
          duration_years: number
          id: string
          institution_id: string
          name: string
          status: string
          updated_at: string
        }
        Insert: {
          award: string
          code: string
          created_at?: string
          department_id: string
          duration_years: number
          id?: string
          institution_id: string
          name: string
          status?: string
          updated_at?: string
        }
        Update: {
          award?: string
          code?: string
          created_at?: string
          department_id?: string
          duration_years?: number
          id?: string
          institution_id?: string
          name?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "programmes_institution_id_department_id_fkey"
            columns: ["institution_id", "department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["institution_id", "id"]
          },
          {
            foreignKeyName: "programmes_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
        ]
      }
      role_assignments: {
        Row: {
          assigned_by: string | null
          created_at: string
          expires_at: string | null
          id: string
          institution_id: string | null
          role: string
          user_id: string
        }
        Insert: {
          assigned_by?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          institution_id?: string | null
          role: string
          user_id: string
        }
        Update: {
          assigned_by?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          institution_id?: string | null
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_assignments_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
        ]
      }
      student_profiles: {
        Row: {
          created_at: string
          current_level: number
          entry_year: number
          id: string
          institution_id: string
          matriculation_number: string | null
          membership_id: string
          programme_id: string
          updated_at: string
          verification_tier: number
        }
        Insert: {
          created_at?: string
          current_level: number
          entry_year: number
          id?: string
          institution_id: string
          matriculation_number?: string | null
          membership_id: string
          programme_id: string
          updated_at?: string
          verification_tier?: number
        }
        Update: {
          created_at?: string
          current_level?: number
          entry_year?: number
          id?: string
          institution_id?: string
          matriculation_number?: string | null
          membership_id?: string
          programme_id?: string
          updated_at?: string
          verification_tier?: number
        }
        Relationships: [
          {
            foreignKeyName: "student_profiles_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_profiles_institution_id_membership_id_fkey"
            columns: ["institution_id", "membership_id"]
            isOneToOne: false
            referencedRelation: "institution_memberships"
            referencedColumns: ["institution_id", "id"]
          },
          {
            foreignKeyName: "student_profiles_institution_id_programme_id_fkey"
            columns: ["institution_id", "programme_id"]
            isOneToOne: false
            referencedRelation: "programmes"
            referencedColumns: ["institution_id", "id"]
          },
        ]
      }
      timetable_events: {
        Row: {
          created_at: string
          ends_at: string
          event_type: string
          id: string
          institution_id: string
          offering_id: string | null
          owner_user_id: string | null
          source: string
          starts_at: string
          status: string
          title: string
          updated_at: string
          venue_name: string | null
        }
        Insert: {
          created_at?: string
          ends_at: string
          event_type: string
          id?: string
          institution_id: string
          offering_id?: string | null
          owner_user_id?: string | null
          source: string
          starts_at: string
          status?: string
          title: string
          updated_at?: string
          venue_name?: string | null
        }
        Update: {
          created_at?: string
          ends_at?: string
          event_type?: string
          id?: string
          institution_id?: string
          offering_id?: string | null
          owner_user_id?: string | null
          source?: string
          starts_at?: string
          status?: string
          title?: string
          updated_at?: string
          venue_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "timetable_events_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timetable_events_institution_id_offering_id_fkey"
            columns: ["institution_id", "offering_id"]
            isOneToOne: false
            referencedRelation: "course_offerings"
            referencedColumns: ["institution_id", "id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      review_agent_application: {
        Args: {
          actor_id: string
          review_decision: string
          review_reason: string
          target_application_id: string
        }
        Returns: {
          applicant_type: string
          applicant_user_id: string
          created_at: string
          current_level: number | null
          desired_roles: string[]
          email: string
          full_name: string
          id: string
          institution_id: string
          last_reviewed_at: string | null
          matriculation_number: string | null
          phone: string
          programme: string | null
          statement: string
          status: string
          status_reason: string | null
          submitted_at: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "agent_applications"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      review_agent_document: {
        Args: {
          actor_id: string
          review_outcome: string
          review_reason: string
          target_document_id: string
        }
        Returns: {
          application_id: string
          checked_at: string | null
          created_at: string
          extracted_name: string | null
          id: string
          institution_id: string
          kind: string
          mime_type: string
          name_match_score: number | null
          object_path: string
          original_filename: string
          sha256: string | null
          size_bytes: number
          updated_at: string
          upload_status: string
          verification_status: string
        }
        SetofOptions: {
          from: "*"
          to: "agent_application_documents"
          isOneToOne: true
          isSetofReturn: false
        }
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
