/**
 * Supabase database type definitions matching postgrest-js GenericSchema.
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      settings: {
        Row: {
          key: string
          value: Json
        }
        Insert: {
          key: string
          value: Json
        }
        Update: {
          key?: string
          value?: Json
        }
        Relationships: []
      }

      teams: {
        Row: {
          id: string
          name: string
          captain_id: string | null
          locked: boolean
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          captain_id?: string | null
          locked?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          name?: string
          captain_id?: string | null
          locked?: boolean
          created_at?: string
        }
        Relationships: []
      }

      members: {
        Row: {
          id: string
          team_id: string
          name: string
          email: string
          college: string | null
          created_at: string
        }
        Insert: {
          id?: string
          team_id: string
          name: string
          email: string
          college?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          team_id?: string
          name?: string
          email?: string
          college?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "members_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          }
        ]
      }

      topics: {
        Row: {
          id: string
          level: "easy" | "hard"
          title: string
          description: string | null
          criterion: Json | null
        }
        Insert: {
          id?: string
          level: "easy" | "hard"
          title: string
          description?: string | null
          criterion?: Json | null
        }
        Update: {
          id?: string
          level?: "easy" | "hard"
          title?: string
          description?: string | null
          criterion?: Json | null
        }
        Relationships: []
      }

      slots: {
        Row: {
          id: string
          topic_id: string
          round: 1 | 2
          status: "pending" | "open" | "sold" | "skipped"
          current_bid: number
          leader_team_id: string | null
          end_time: string | null
          winner_team_id: string | null
        }
        Insert: {
          id?: string
          topic_id: string
          round: 1 | 2
          status?: "pending" | "open" | "sold" | "skipped"
          current_bid?: number
          leader_team_id?: string | null
          end_time?: string | null
          winner_team_id?: string | null
        }
        Update: {
          id?: string
          topic_id?: string
          round?: 1 | 2
          status?: "pending" | "open" | "sold" | "skipped"
          current_bid?: number
          leader_team_id?: string | null
          end_time?: string | null
          winner_team_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "slots_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "topics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "slots_leader_team_id_fkey"
            columns: ["leader_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "slots_winner_team_id_fkey"
            columns: ["winner_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          }
        ]
      }

      wallets: {
        Row: {
          team_id: string
          balance: number
          created_at: string
        }
        Insert: {
          team_id: string
          balance?: number
          created_at?: string
        }
        Update: {
          team_id?: string
          balance?: number
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "wallets_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: true
            referencedRelation: "teams"
            referencedColumns: ["id"]
          }
        ]
      }

      bids: {
        Row: {
          id: string
          slot_id: string
          team_id: string
          amount: number
          server_time: string
        }
        Insert: {
          id?: string
          slot_id: string
          team_id: string
          amount: number
          server_time?: string
        }
        Update: {
          id?: string
          slot_id?: string
          team_id?: string
          amount?: number
          server_time?: string
        }
        Relationships: [
          {
            foreignKeyName: "bids_slot_id_fkey"
            columns: ["slot_id"]
            isOneToOne: false
            referencedRelation: "slots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bids_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          }
        ]
      }

      challenge_problems: {
        Row: {
          id: string
          topic_id: string
          title: string
          description: string
          difficulty: "easy" | "medium" | "hard"
          test_cases: Json
          points: number
          created_at: string
        }
        Insert: {
          id?: string
          topic_id: string
          title: string
          description: string
          difficulty?: "easy" | "medium" | "hard"
          test_cases?: Json
          points?: number
          created_at?: string
        }
        Update: {
          id?: string
          topic_id?: string
          title?: string
          description?: string
          difficulty?: "easy" | "medium" | "hard"
          test_cases?: Json
          points?: number
          created_at?: string
        }
        Relationships: []
      }

      challenge_solves: {
        Row: {
          id: string
          team_id: string
          problem_id: string
          solved_at: string
        }
        Insert: {
          id?: string
          team_id: string
          problem_id: string
          solved_at?: string
        }
        Update: {
          id?: string
          team_id?: string
          problem_id?: string
          solved_at?: string
        }
        Relationships: []
      }

      submissions: {
        Row: {
          id: string
          team_id: string
          slot_id: string
          repository_url: string | null
          submitted_by: string | null
          submitted_at: string
          status: "submitted" | "evaluating" | "evaluated" | "review"
        }
        Insert: {
          id?: string
          team_id: string
          slot_id: string
          repository_url?: string | null
          submitted_by?: string | null
          submitted_at?: string
          status?: "submitted" | "evaluating" | "evaluated" | "review"
        }
        Update: {
          id?: string
          team_id?: string
          slot_id?: string
          repository_url?: string | null
          submitted_by?: string | null
          submitted_at?: string
          status?: "submitted" | "evaluating" | "evaluated" | "review"
        }
        Relationships: []
      }

      evaluations: {
        Row: {
          id: string
          submission_id: string
          score: number
          report: Json
          evaluator_version: string | null
          evaluated_at: string
          status: "queued" | "running" | "completed" | "failed" | "review"
        }
        Insert: {
          id?: string
          submission_id: string
          score?: number
          report?: Json
          evaluator_version?: string | null
          evaluated_at?: string
          status?: "queued" | "running" | "completed" | "failed" | "review"
        }
        Update: {
          id?: string
          submission_id?: string
          score?: number
          report?: Json
          evaluator_version?: string | null
          evaluated_at?: string
          status?: "queued" | "running" | "completed" | "failed" | "review"
        }
        Relationships: []
      }

      eval_updates: {
        Row: {
          id: string
          evaluation_id: string
          message: string
          details: Json
          created_at: string
        }
        Insert: {
          id?: string
          evaluation_id: string
          message: string
          details?: Json
          created_at?: string
        }
        Update: {
          id?: string
          evaluation_id?: string
          message?: string
          details?: Json
          created_at?: string
        }
        Relationships: []
      }

      audit_log: {
        Row: {
          id: string
          actor_id: string | null
          actor_team_id: string | null
          action: string
          entity_type: string | null
          entity_id: string | null
          details: Json
          created_at: string
        }
        Insert: {
          id?: string
          actor_id?: string | null
          actor_team_id?: string | null
          action: string
          entity_type?: string | null
          entity_id?: string | null
          details?: Json
          created_at?: string
        }
        Update: {
          id?: string
          actor_id?: string | null
          actor_team_id?: string | null
          action?: string
          entity_type?: string | null
          entity_id?: string | null
          details?: Json
          created_at?: string
        }
        Relationships: []
      }
    }

    Views: {
      [_ in never]: never
    }

    Functions: {
      place_bid: {
        Args: {
          p_slot_id: string
          p_amount: number
        }
        Returns: Json
      }
      open_slot: {
        Args: {
          p_slot_id: string
        }
        Returns: Json
      }
      close_slot: {
        Args: {
          p_slot_id: string
        }
        Returns: Json
      }
      skip_slot: {
        Args: {
          p_slot_id: string
        }
        Returns: Json
      }
      current_team_id: {
        Args: Record<PropertyKey, never>
        Returns: string
      }
      is_team_captain: {
        Args: Record<PropertyKey, never>
        Returns: boolean
      }
      is_admin: {
        Args: Record<PropertyKey, never>
        Returns: boolean
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

export type SettingsRow         = Database["public"]["Tables"]["settings"]["Row"]
export type TeamRow             = Database["public"]["Tables"]["teams"]["Row"]
export type MemberRow           = Database["public"]["Tables"]["members"]["Row"]
export type TopicRow            = Database["public"]["Tables"]["topics"]["Row"]
export type SlotRow             = Database["public"]["Tables"]["slots"]["Row"]
export type WalletRow           = Database["public"]["Tables"]["wallets"]["Row"]
export type BidRow              = Database["public"]["Tables"]["bids"]["Row"]
export type ChallengeProblemRow = Database["public"]["Tables"]["challenge_problems"]["Row"]
export type ChallengeSolveRow   = Database["public"]["Tables"]["challenge_solves"]["Row"]
export type SubmissionRow       = Database["public"]["Tables"]["submissions"]["Row"]
export type EvaluationRow       = Database["public"]["Tables"]["evaluations"]["Row"]
export type EvalUpdateRow       = Database["public"]["Tables"]["eval_updates"]["Row"]
export type AuditLogRow         = Database["public"]["Tables"]["audit_log"]["Row"]
