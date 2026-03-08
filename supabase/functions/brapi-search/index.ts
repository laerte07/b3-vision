import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Auth
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const authHeader = req.headers.get("Authorization") ?? "";
    const { data: { user }, error: authErr } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", "")
    );
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { query } = await req.json();
    if (!query || typeof query !== "string" || query.length < 2) {
      return new Response(JSON.stringify({ results: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const brapiToken = Deno.env.get("BRAPI_TOKEN");
    if (!brapiToken) {
      return new Response(JSON.stringify({ error: "BRAPI_TOKEN not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Use BRAPI available endpoint to search tickers
    const searchUrl = `https://brapi.dev/api/available?token=${brapiToken}&search=${encodeURIComponent(query.toUpperCase())}`;
    console.log(`BRAPI search: ${searchUrl}`);
    const res = await fetch(searchUrl);
    const raw = await res.text();

    if (!res.ok) {
      console.error(`BRAPI search error: status=${res.status} body=${raw}`);
      return new Response(JSON.stringify({ results: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = JSON.parse(raw);
    // BRAPI /available returns { stocks: ["PETR4", "PETR3", ...] }
    const tickers: string[] = (data.stocks ?? []).slice(0, 20);

    // For each ticker, try to classify by suffix
    const results = tickers.map((ticker: string) => {
      const t = ticker.toUpperCase();
      let classSlug = "acoes";
      if (/\d{2}$/.test(t)) classSlug = "fiis"; // e.g. MXRF11
      if (t.endsWith("39") || t.endsWith("34") || t.endsWith("35")) classSlug = "bdrs";
      if (t.startsWith("IVVB") || t.startsWith("BOVA") || t.startsWith("SMAL") || t.startsWith("HASH") || t.startsWith("DIVO")) classSlug = "etfs";
      // simple heuristic, 11 suffix is FII/ETF
      if (t.match(/11$/)) {
        // could be FII or ETF; default to fiis, common ETFs override above
        if (classSlug === "acoes") classSlug = "fiis";
      }
      return { ticker: t, classSlug };
    });

    return new Response(JSON.stringify({ results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("brapi-search error:", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
