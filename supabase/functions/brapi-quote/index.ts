import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function safeNum(v: any): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function pctFromRatio(v: any): number | null {
  // BRAPI/Yahoo costuma retornar ratios como 0.12 = 12%
  const n = safeNum(v);
  if (n === null) return null;
  return n * 100;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

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
      return new Response(JSON.stringify({ error: "No active assets found", updated: 0 }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const brapiToken = Deno.env.get("BRAPI_TOKEN");
    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const results: any[] = [];
    const modules = "summaryProfile,defaultKeyStatistics,financialData,dividendsData";

    for (const asset of assets) {
      try {
        const brapiUrl = `https://brapi.dev/api/quote/${asset.ticker}?token=${brapiToken}&modules=${modules}`;
        const brapiRes = await fetch(brapiUrl);
        const brapiData = await brapiRes.json();

        if (!brapiData?.results?.length) {
          results.push({ ticker: asset.ticker, error: "No BRAPI data" });
          continue;
        }

        const quote = brapiData.results[0];
        const now = new Date().toISOString();

        // ---------------- PRICE CACHE ----------------
        const priceData = {
          asset_id: asset.id,
          last_price: safeNum(quote.regularMarketPrice),
          change_percent: safeNum(quote.regularMarketChangePercent),
          logo_url: quote.logourl ?? quote.logoUrl ?? null,
          updated_at: now,
          source: "brapi",
        };

        const { error: upsertPriceErr } = await serviceClient
          .from("price_cache")
          .upsert(priceData, { onConflict: "asset_id" });

        // ---------------- DIVIDENDS CACHE (ALWAYS UPSERT) ----------------
        let div12m: number = 0;
        let dy12m: number = 0;

        const price = safeNum(quote.regularMarketPrice) ?? 0;

        if (quote.dividendsData?.cashDividends?.length) {
          const oneYearAgo = new Date();
          oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

          const divs = quote.dividendsData.cashDividends.filter((d: any) => {
            const dt = d?.paymentDate ?? d?.date ?? d?.approvedDate ?? null;
            if (!dt) return false;
            return new Date(dt) >= oneYearAgo;
          });

          div12m = divs.reduce((s: number, d: any) => s + (safeNum(d.rate) ?? 0), 0);
          dy12m = price > 0 ? (div12m / price) * 100 : 0;
        }

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

        // ---------------- FUNDAMENTALS CACHE (ALWAYS UPSERT ALL FIELDS) ----------------
        const ks = quote.defaultKeyStatistics || {};
        const fd = quote.financialData || {};

        const lpa = safeNum(quote.earningsPerShare) ?? safeNum(ks.trailingEps);
        const vpa = safeNum(ks.bookValue);
        const roe = pctFromRatio(fd.returnOnEquity);
        const peRatio = safeNum(quote.priceEarnings) ?? safeNum(ks.trailingPE);
        const pbRatio = safeNum(ks.priceToBook);
        const ev = safeNum(ks.enterpriseValue);
        const ebitda = safeNum(fd.ebitda);
        const totalShares = safeNum(ks.sharesOutstanding) ?? safeNum(ks.impliedSharesOutstanding);
        const margin = pctFromRatio(fd.profitMargins);
        const revenueGrowth = pctFromRatio(fd.revenueGrowth);
        const payout = pctFromRatio(ks.payoutRatio);

        const totalDebt = safeNum(fd.totalDebt);
        const totalCash = safeNum(fd.totalCash);
        const netDebt = (totalDebt != null && totalCash != null) ? (totalDebt - totalCash) : null;

        // dividend_yield: prefer dy12m computed; fallback to ks.dividendYield
        const dividendYield =
          dy12m > 0 ? dy12m : (ks.dividendYield != null ? pctFromRatio(ks.dividendYield) : null);

        const fundamentalsData = {
          asset_id: asset.id,
          updated_at: now,
          source: "brapi",
          lpa: lpa ?? null,
          vpa: vpa ?? null,
          roe: roe ?? null,
          roe_5y: null,
          payout: payout ?? null,
          payout_5y: null,
          pe_ratio: peRatio ?? null,
          pb_ratio: pbRatio ?? null,
          ev: ev ?? null,
          ebitda: ebitda ?? null,
          net_debt: netDebt ?? null,
          total_shares: totalShares ?? null,
          dividend_yield: dividendYield ?? null,
          margin: margin ?? null,
          revenue_growth: revenueGrowth ?? null,
        };

        await serviceClient
          .from("fundamentals_cache")
          .upsert(fundamentalsData, { onConflict: "asset_id" });

        results.push({
          ticker: quote.symbol ?? asset.ticker,
          price: priceData.last_price,
          change: priceData.change_percent,
          dy12m,
          roe,
          payout,
          peRatio,
          pbRatio,
          revenueGrowth,
          error: upsertPriceErr?.message ?? upsertPriceErr ?? upsertPriceErr ?? null,
          priceUpsertError: upsertPriceErr?.message ?? null,
        });
      } catch (tickerErr) {
        results.push({ ticker: asset.ticker, error: (tickerErr as Error).message });
      }
    }

    return new Response(JSON.stringify({ updated: results.length, results }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
