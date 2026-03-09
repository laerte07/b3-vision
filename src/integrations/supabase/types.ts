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
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      asset_classes: {
        Row: {
          created_at: string
          id: string
          name: string
          slug: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          slug: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          slug?: string
        }
        Relationships: []
      }
      assets: {
        Row: {
          active: boolean
          class_id: string
          created_at: string
          currency: string
          exchange: string
          id: string
          name: string | null
          ticker: string
          user_id: string
        }
        Insert: {
          active?: boolean
          class_id: string
          created_at?: string
          currency?: string
          exchange?: string
          id?: string
          name?: string | null
          ticker: string
          user_id: string
        }
        Update: {
          active?: boolean
          class_id?: string
          created_at?: string
          currency?: string
          exchange?: string
          id?: string
          name?: string | null
          ticker?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "assets_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "asset_classes"
            referencedColumns: ["id"]
          },
        ]
      }
      benchmark_history: {
        Row: {
          benchmark_code: string
          benchmark_name: string
          created_at: string
          date: string
          id: string
          source: string
          updated_at: string
          value: number
        }
        Insert: {
          benchmark_code: string
          benchmark_name: string
          created_at?: string
          date: string
          id?: string
          source: string
          updated_at?: string
          value: number
        }
        Update: {
          benchmark_code?: string
          benchmark_name?: string
          created_at?: string
          date?: string
          id?: string
          source?: string
          updated_at?: string
          value?: number
        }
        Relationships: []
      }
      class_targets: {
        Row: {
          class_id: string
          created_at: string
          id: string
          lower_band: number
          target_percent: number
          upper_band: number
          user_id: string
        }
        Insert: {
          class_id: string
          created_at?: string
          id?: string
          lower_band?: number
          target_percent?: number
          upper_band?: number
          user_id: string
        }
        Update: {
          class_id?: string
          created_at?: string
          id?: string
          lower_band?: number
          target_percent?: number
          upper_band?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "class_targets_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "asset_classes"
            referencedColumns: ["id"]
          },
        ]
      }
      contribution_items: {
        Row: {
          amount: number
          asset_id: string
          contribution_id: string
          created_at: string
          id: string
          quantity: number
          unit_price: number
        }
        Insert: {
          amount?: number
          asset_id: string
          contribution_id: string
          created_at?: string
          id?: string
          quantity?: number
          unit_price?: number
        }
        Update: {
          amount?: number
          asset_id?: string
          contribution_id?: string
          created_at?: string
          id?: string
          quantity?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "contribution_items_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contribution_items_contribution_id_fkey"
            columns: ["contribution_id"]
            isOneToOne: false
            referencedRelation: "contributions"
            referencedColumns: ["id"]
          },
        ]
      }
      contributions: {
        Row: {
          allocation_mode: string
          contribution_date: string
          created_at: string
          id: string
          note: string | null
          total_amount: number
          user_id: string
        }
        Insert: {
          allocation_mode?: string
          contribution_date?: string
          created_at?: string
          id?: string
          note?: string | null
          total_amount?: number
          user_id: string
        }
        Update: {
          allocation_mode?: string
          contribution_date?: string
          created_at?: string
          id?: string
          note?: string | null
          total_amount?: number
          user_id?: string
        }
        Relationships: []
      }
      correlation_matrix: {
        Row: {
          corr_value: number
          created_at: string
          id: string
          item_a: string
          item_b: string
          note: string | null
          user_id: string
        }
        Insert: {
          corr_value?: number
          created_at?: string
          id?: string
          item_a: string
          item_b: string
          note?: string | null
          user_id: string
        }
        Update: {
          corr_value?: number
          created_at?: string
          id?: string
          item_a?: string
          item_b?: string
          note?: string | null
          user_id?: string
        }
        Relationships: []
      }
      dividends_cache: {
        Row: {
          asset_id: string
          div_12m: number | null
          dy_12m: number | null
          id: string
          source: string
          updated_at: string
        }
        Insert: {
          asset_id: string
          div_12m?: number | null
          dy_12m?: number | null
          id?: string
          source?: string
          updated_at?: string
        }
        Update: {
          asset_id?: string
          div_12m?: number | null
          dy_12m?: number | null
          id?: string
          source?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "dividends_cache_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: true
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
        ]
      }
      fundamentals_cache: {
        Row: {
          asset_id: string
          dividend_yield: number | null
          ebitda: number | null
          ev: number | null
          id: string
          lpa: number | null
          margin: number | null
          net_debt: number | null
          payout: number | null
          payout_5y: number | null
          pb_ratio: number | null
          pe_ratio: number | null
          revenue_growth: number | null
          roe: number | null
          roe_5y: number | null
          source: string
          total_shares: number | null
          updated_at: string
          vpa: number | null
        }
        Insert: {
          asset_id: string
          dividend_yield?: number | null
          ebitda?: number | null
          ev?: number | null
          id?: string
          lpa?: number | null
          margin?: number | null
          net_debt?: number | null
          payout?: number | null
          payout_5y?: number | null
          pb_ratio?: number | null
          pe_ratio?: number | null
          revenue_growth?: number | null
          roe?: number | null
          roe_5y?: number | null
          source?: string
          total_shares?: number | null
          updated_at?: string
          vpa?: number | null
        }
        Update: {
          asset_id?: string
          dividend_yield?: number | null
          ebitda?: number | null
          ev?: number | null
          id?: string
          lpa?: number | null
          margin?: number | null
          net_debt?: number | null
          payout?: number | null
          payout_5y?: number | null
          pb_ratio?: number | null
          pe_ratio?: number | null
          revenue_growth?: number | null
          roe?: number | null
          roe_5y?: number | null
          source?: string
          total_shares?: number | null
          updated_at?: string
          vpa?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "fundamentals_cache_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: true
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
        ]
      }
      fundamentals_overrides: {
        Row: {
          asset_id: string
          id: string
          override_json: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          asset_id: string
          id?: string
          override_json?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          asset_id?: string
          id?: string
          override_json?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fundamentals_overrides_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
        ]
      }
      positions: {
        Row: {
          asset_id: string
          avg_price: number
          created_at: string
          id: string
          quantity: number
          user_id: string
        }
        Insert: {
          asset_id: string
          avg_price?: number
          created_at?: string
          id?: string
          quantity?: number
          user_id: string
        }
        Update: {
          asset_id?: string
          avg_price?: number
          created_at?: string
          id?: string
          quantity?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "positions_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
        ]
      }
      price_cache: {
        Row: {
          asset_id: string
          change_percent: number | null
          id: string
          industry: string | null
          last_price: number | null
          logo_url: string | null
          sector: string | null
          source: string
          updated_at: string
        }
        Insert: {
          asset_id: string
          change_percent?: number | null
          id?: string
          industry?: string | null
          last_price?: number | null
          logo_url?: string | null
          sector?: string | null
          source?: string
          updated_at?: string
        }
        Update: {
          asset_id?: string
          change_percent?: number | null
          id?: string
          industry?: string | null
          last_price?: number | null
          logo_url?: string | null
          sector?: string | null
          source?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "price_cache_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: true
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      score_history: {
        Row: {
          asset_id: string
          created_at: string
          id: string
          json_details: Json
          score_dividends: number
          score_growth: number
          score_quality: number
          score_risk: number
          score_total: number
          score_valuation: number
          snapshot_date: string
          user_id: string
        }
        Insert: {
          asset_id: string
          created_at?: string
          id?: string
          json_details?: Json
          score_dividends?: number
          score_growth?: number
          score_quality?: number
          score_risk?: number
          score_total?: number
          score_valuation?: number
          snapshot_date?: string
          user_id: string
        }
        Update: {
          asset_id?: string
          created_at?: string
          id?: string
          json_details?: Json
          score_dividends?: number
          score_growth?: number
          score_quality?: number
          score_risk?: number
          score_total?: number
          score_valuation?: number
          snapshot_date?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "score_history_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
        ]
      }
      transactions: {
        Row: {
          asset_id: string
          created_at: string
          date: string
          fees: number
          id: string
          price: number
          quantity: number
          type: string
          user_id: string
        }
        Insert: {
          asset_id: string
          created_at?: string
          date?: string
          fees?: number
          id?: string
          price?: number
          quantity?: number
          type: string
          user_id: string
        }
        Update: {
          asset_id?: string
          created_at?: string
          date?: string
          fees?: number
          id?: string
          price?: number
          quantity?: number
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transactions_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
        ]
      }
      valuation_models: {
        Row: {
          asset_id: string
          created_at: string
          id: string
          json_params: Json
          model_type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          asset_id: string
          created_at?: string
          id?: string
          json_params?: Json
          model_type: string
          updated_at?: string
          user_id: string
        }
        Update: {
          asset_id?: string
          created_at?: string
          id?: string
          json_params?: Json
          model_type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "valuation_models_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
        ]
      }
      valuation_results: {
        Row: {
          asset_id: string
          created_at: string
          fair_value: number | null
          id: string
          json_breakdown: Json
          max_buy_price: number | null
          model_type: string
          updated_at: string
          upside: number | null
          user_id: string
        }
        Insert: {
          asset_id: string
          created_at?: string
          fair_value?: number | null
          id?: string
          json_breakdown?: Json
          max_buy_price?: number | null
          model_type: string
          updated_at?: string
          upside?: number | null
          user_id: string
        }
        Update: {
          asset_id?: string
          created_at?: string
          fair_value?: number | null
          id?: string
          json_breakdown?: Json
          max_buy_price?: number | null
          model_type?: string
          updated_at?: string
          upside?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "valuation_results_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
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
