export type Database = {
  public: {
    Tables: {
      organizations: {
        Row: {
          id: string;
          name: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      organization_memberships: {
        Row: {
          id: string;
          organization_id: string;
          user_id: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          user_id: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          user_id?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "organization_memberships_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      sites: {
        Row: {
          id: string;
          organization_id: string;
          name: string;
          url: string;
          slug: string;
          favicon_url: string | null;
          archived_at: string | null;
          search_console_property_url: string | null;
          search_console_property_type: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          name: string;
          url: string;
          slug: string;
          favicon_url?: string | null;
          archived_at?: string | null;
          search_console_property_url?: string | null;
          search_console_property_type?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          name?: string;
          url?: string;
          slug?: string;
          favicon_url?: string | null;
          archived_at?: string | null;
          search_console_property_url?: string | null;
          search_console_property_type?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "sites_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      crawl_runs: {
        Row: {
          id: string;
          site_id: string;
          organization_id: string;
          triggered_by: string;
          status: string;
          started_at: string;
          completed_at: string | null;
          pages_crawled: number;
          error_message: string | null;
          robots_txt_status: number | null;
          robots_txt_fetch_error: string | null;
        };
        Insert: {
          id?: string;
          site_id: string;
          organization_id: string;
          triggered_by: string;
          status?: string;
          started_at?: string;
          completed_at?: string | null;
          pages_crawled?: number;
          error_message?: string | null;
          robots_txt_status?: number | null;
          robots_txt_fetch_error?: string | null;
        };
        Update: {
          id?: string;
          site_id?: string;
          organization_id?: string;
          triggered_by?: string;
          status?: string;
          started_at?: string;
          completed_at?: string | null;
          pages_crawled?: number;
          error_message?: string | null;
          robots_txt_status?: number | null;
          robots_txt_fetch_error?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "crawl_runs_site_id_fkey";
            columns: ["site_id"];
            isOneToOne: false;
            referencedRelation: "sites";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "crawl_runs_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      crawl_pages: {
        Row: {
          id: string;
          crawl_run_id: string;
          organization_id: string;
          url: string;
          http_status: number | null;
          title: string | null;
          meta_description: string | null;
          canonical_url: string | null;
          h1: string | null;
          is_indexable: boolean;
          robots_directives: string | null;
          internal_link_count: number;
          fetch_error: string | null;
          created_at: string;
          final_url: string | null;
          redirect_count: number;
        };
        Insert: {
          id?: string;
          crawl_run_id: string;
          organization_id: string;
          url: string;
          http_status?: number | null;
          title?: string | null;
          meta_description?: string | null;
          canonical_url?: string | null;
          h1?: string | null;
          is_indexable?: boolean;
          robots_directives?: string | null;
          internal_link_count?: number;
          fetch_error?: string | null;
          created_at?: string;
          final_url?: string | null;
          redirect_count?: number;
        };
        Update: {
          id?: string;
          crawl_run_id?: string;
          organization_id?: string;
          url?: string;
          http_status?: number | null;
          title?: string | null;
          meta_description?: string | null;
          canonical_url?: string | null;
          h1?: string | null;
          is_indexable?: boolean;
          robots_directives?: string | null;
          internal_link_count?: number;
          fetch_error?: string | null;
          created_at?: string;
          final_url?: string | null;
          redirect_count?: number;
        };
        Relationships: [
          {
            foreignKeyName: "crawl_pages_crawl_run_id_fkey";
            columns: ["crawl_run_id"];
            isOneToOne: false;
            referencedRelation: "crawl_runs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "crawl_pages_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      crawl_issues: {
        Row: {
          id: string;
          crawl_run_id: string;
          crawl_page_id: string;
          organization_id: string;
          issue_type: string;
          severity: string;
          message: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          crawl_run_id: string;
          crawl_page_id: string;
          organization_id: string;
          issue_type: string;
          severity: string;
          message: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          crawl_run_id?: string;
          crawl_page_id?: string;
          organization_id?: string;
          issue_type?: string;
          severity?: string;
          message?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "crawl_issues_crawl_run_id_fkey";
            columns: ["crawl_run_id"];
            isOneToOne: false;
            referencedRelation: "crawl_runs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "crawl_issues_crawl_page_id_fkey";
            columns: ["crawl_page_id"];
            isOneToOne: false;
            referencedRelation: "crawl_pages";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "crawl_issues_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      google_connections: {
        Row: {
          id: string;
          organization_id: string;
          refresh_token: string;
          access_token: string | null;
          access_token_expires_at: string | null;
          scope: string;
          needs_reauth: boolean;
          connected_by: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          refresh_token: string;
          access_token?: string | null;
          access_token_expires_at?: string | null;
          scope: string;
          needs_reauth?: boolean;
          connected_by: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          refresh_token?: string;
          access_token?: string | null;
          access_token_expires_at?: string | null;
          scope?: string;
          needs_reauth?: boolean;
          connected_by?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "google_connections_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: true;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: Record<string, never>;
    Functions: {
      create_organization: {
        Args: { org_name: string };
        Returns: {
          id: string;
          name: string;
          created_at: string;
        };
      };
      update_site_favicon: {
        Args: { site_id: string; favicon_url: string | null };
        Returns: undefined;
      };
      archive_site: {
        Args: { site_id: string };
        Returns: undefined;
      };
      restore_site: {
        Args: { site_id: string };
        Returns: undefined;
      };
      delete_site_permanently: {
        Args: { site_id: string };
        Returns: undefined;
      };
      get_google_connection_status: {
        Args: { p_organization_id: string };
        Returns: {
          connected: boolean;
          needs_reauth: boolean;
          connected_at: string | null;
        }[];
      };
      set_site_search_console_property: {
        Args: { site_id: string; property_url: string; property_type: string };
        Returns: undefined;
      };
      clear_site_search_console_property: {
        Args: { site_id: string };
        Returns: undefined;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
