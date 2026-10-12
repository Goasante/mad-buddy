export type Database = { public: { Tables: {
      book_orders: {
        Row: { id: string; product: string; reference: string; email: string; amount_minor: number; currency: string; status: "pending" | "paid" | "revoked"; browser_proof_hash: string; created_at: string; paid_at: string | null; receipt_sent_at: string | null };
        Insert: { id?: string; product: string; reference: string; email: string; amount_minor: number; currency: string; status?: "pending" | "paid" | "revoked"; browser_proof_hash: string; created_at?: string; paid_at?: string | null; receipt_sent_at?: string | null };
        Update: { status?: "pending" | "paid" | "revoked"; paid_at?: string | null; receipt_sent_at?: string | null };
        Relationships: [];
      };
}; Views: Record<string, never>; Functions: {
      consume_rate_limit: {
        Args: {
          p_user_id: string | null;
          p_ip_hash: string | null;
          p_action: string;
          p_limit: number;
          p_window_seconds: number;
        };
        Returns: Array<{ allowed: boolean; remaining: number; reset_at: string }>;
      };
}; Enums: Record<string, never>; CompositeTypes: Record<string, never>; }; };
