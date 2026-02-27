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
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userId = claimsData.claims.sub;

    // Get user's active tickers
    const { data: assets, error: assetsErr } = await supabase
      .from("assets")
      .select("id, ticker")
      .eq("user_id", userId)
      .eq("active", true);

    if (assetsErr || !assets || assets.length === 0) {
      return new Response(
        JSON.stringify({ error: "No active assets found", updated: 0 }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const tickers = assets.map((a: any) => a.ticker).join(",");
    const brapiToken = Deno.env.get("BRAPI_TOKEN");

    const brapiUrl = `https://brapi.dev/api/quote/${tickers}?token=${brapiToken}`;
    const brapiRes = await fetch(brapiUrl);
    const brapiData = await brapiRes.json();

    if (!brapiData.results) {
      return new Response(
        JSON.stringify({ error: "BRAPI returned no results", raw: brapiData }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const results: any[] = [];
    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    for (const quote of brapiData.results) {
      const asset = assets.find(
        (a: any) => a.ticker.toUpperCase() === quote.symbol?.toUpperCase()
      );
      if (!asset) continue;

      const priceData = {
        asset_id: asset.id,
        last_price: quote.regularMarketPrice ?? null,
        change_percent: quote.regularMarketChangePercent ?? null,
        logo_url: quote.logourl ?? null,
        updated_at: new Date().toISOString(),
        source: "brapi",
      };

      const { error: upsertErr } = await serviceClient
        .from("price_cache")
        .upsert(priceData, { onConflict: "asset_id" });

      // Try dividends if available
      if (quote.dividendsData?.cashDividends) {
        const now = new Date();
        const oneYearAgo = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
        const divs = quote.dividendsData.cashDividends.filter(
          (d: any) => new Date(d.paymentDate) >= oneYearAgo
        );
        const div12m = divs.reduce((s: number, d: any) => s + (d.rate || 0), 0);
        const dy12m =
          quote.regularMarketPrice > 0 ? (div12m / quote.regularMarketPrice) * 100 : 0;

        await serviceClient.from("dividends_cache").upsert(
          {
            asset_id: asset.id,
            div_12m: div12m,
            dy_12m: dy12m,
            updated_at: new Date().toISOString(),
            source: "brapi",
          },
          { onConflict: "asset_id" }
        );
      }

      results.push({
        ticker: quote.symbol,
        price: quote.regularMarketPrice,
        change: quote.regularMarketChangePercent,
        error: upsertErr?.message ?? null,
      });
    }

    return new Response(
      JSON.stringify({ updated: results.length, results }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
