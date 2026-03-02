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

    const brapiToken = Deno.env.get("BRAPI_TOKEN");
    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const results: any[] = [];

    // Fetch one ticker at a time to respect BRAPI plan limits
    for (const asset of assets) {
      try {
        const brapiUrl = `https://brapi.dev/api/quote/${asset.ticker}?token=${brapiToken}&modules=summaryProfile,defaultKeyStatistics,financialData,dividendsData`;
        const brapiRes = await fetch(brapiUrl);
        const brapiData = await brapiRes.json();

        if (!brapiData.results || brapiData.results.length === 0) {
          results.push({ ticker: asset.ticker, error: "No BRAPI data" });
          continue;
        }

        const quote = brapiData.results[0];
        const now = new Date().toISOString();

        // Price cache
        const priceData = {
          asset_id: asset.id,
          last_price: quote.regularMarketPrice ?? null,
          change_percent: quote.regularMarketChangePercent ?? null,
          logo_url: quote.logourl ?? null,
          updated_at: now,
          source: "brapi",
        };

        const { error: upsertErr } = await serviceClient
          .from("price_cache")
          .upsert(priceData, { onConflict: "asset_id" });

        // Dividends cache
        if (quote.dividendsData?.cashDividends && quote.dividendsData.cashDividends.length > 0) {
          const oneYearAgo = new Date();
          oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
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
              updated_at: now,
              source: "brapi",
            },
            { onConflict: "asset_id" }
          );
        }

        // Also populate dividend_yield from defaultKeyStatistics or dividendsData
        const ks = quote.defaultKeyStatistics || {};
        const fd = quote.financialData || {};

        const lpa = quote.earningsPerShare ?? ks.trailingEps ?? null;
        const vpa = ks.bookValue ?? null;
        const roe = fd.returnOnEquity != null ? fd.returnOnEquity * 100 : null;
        const peRatio = quote.priceEarnings ?? ks.trailingPE ?? null;
        const pbRatio = ks.priceToBook ?? null;
        const ev = ks.enterpriseValue ?? null;
        const ebitda = fd.ebitda ?? null;
        const totalShares = ks.sharesOutstanding ?? ks.impliedSharesOutstanding ?? null;
        const margin = fd.profitMargins != null ? fd.profitMargins * 100 : null;
        const revenueGrowth = fd.revenueGrowth != null ? fd.revenueGrowth * 100 : null;
        const payout = ks.payoutRatio != null ? ks.payoutRatio * 100 : null;
        const netDebt = fd.totalDebt != null && fd.totalCash != null ? fd.totalDebt - fd.totalCash : null;

        // Calculate dividend_yield from dividendsData if available, fallback to ks
        let dividendYield: number | null = null;
        if (quote.dividendsData?.cashDividends && quote.dividendsData.cashDividends.length > 0 && quote.regularMarketPrice > 0) {
          const oneYearAgo = new Date();
          oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
          const divs12m = quote.dividendsData.cashDividends.filter(
            (d: any) => new Date(d.paymentDate) >= oneYearAgo
          );
          const totalDiv = divs12m.reduce((s: number, d: any) => s + (d.rate || 0), 0);
          dividendYield = (totalDiv / quote.regularMarketPrice) * 100;
        } else if (ks.dividendYield != null) {
          dividendYield = ks.dividendYield * 100;
        }

        const fundamentalsData: Record<string, any> = {
          asset_id: asset.id,
          updated_at: now,
          source: "brapi",
        };
        if (lpa != null) fundamentalsData.lpa = lpa;
        if (vpa != null) fundamentalsData.vpa = vpa;
        if (roe != null) fundamentalsData.roe = roe;
        if (peRatio != null) fundamentalsData.pe_ratio = peRatio;
        if (pbRatio != null) fundamentalsData.pb_ratio = pbRatio;
        if (ev != null) fundamentalsData.ev = ev;
        if (ebitda != null) fundamentalsData.ebitda = ebitda;
        if (totalShares != null) fundamentalsData.total_shares = totalShares;
        if (dividendYield != null) fundamentalsData.dividend_yield = dividendYield;
        if (margin != null) fundamentalsData.margin = margin;
        if (revenueGrowth != null) fundamentalsData.revenue_growth = revenueGrowth;
        if (payout != null) fundamentalsData.payout = payout;
        if (netDebt != null) fundamentalsData.net_debt = netDebt;

        await serviceClient.from("fundamentals_cache").upsert(
          fundamentalsData,
          { onConflict: "asset_id" }
        );

        results.push({
          ticker: quote.symbol,
          price: quote.regularMarketPrice,
          change: quote.regularMarketChangePercent,
          lpa,
          vpa,
          roe,
          dividendYield,
          error: upsertErr?.message ?? null,
        });
      } catch (tickerErr) {
        results.push({ ticker: asset.ticker, error: (tickerErr as Error).message });
      }
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
