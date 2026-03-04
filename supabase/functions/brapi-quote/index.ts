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

    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized", detail: userError?.message ?? "No user" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = userData.user.id;

    const { data: assets, error: assetsErr } = await supabase
      .from("assets")
      .select("id, ticker")
      .eq("user_id", userId)
      .eq("active", true);

    if (assetsErr) {
      return new Response(JSON.stringify({ error: assetsErr.message, updated: 0 }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!assets || assets.length === 0) {
      return new Response(JSON.stringify({ error: "No active assets found", updated: 0, ok_count: 0, error_count: 0, results: [] }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ---- BRAPI TOKEN ----
    const brapiToken = Deno.env.get("BRAPI_TOKEN");
    console.log("BRAPI_TOKEN present:", !!brapiToken, "length:", brapiToken?.length ?? 0);
    if (!brapiToken || brapiToken.trim().length < 5) {
      return new Response(JSON.stringify({
        error: "BRAPI_TOKEN missing/empty in Supabase secrets",
        updated: 0, ok_count: 0, error_count: 0,
      }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ---- SELF-TEST with PETR4 ----
    let debugSelfTest: any = {};
    try {
      const testTicker = "PETR4";
      // Build URL as plain string to avoid %2C encoding of commas
      const testUrl = `https://brapi.dev/api/quote/${testTicker}?token=${brapiToken}`;
      console.log("SELF-TEST URL:", testUrl);
      const testRes = await fetch(testUrl);
      const testRaw = await testRes.text();
      console.log("SELF-TEST status:", testRes.status, "body:", testRaw.slice(0, 500));
      let testData: any = null;
      try { testData = JSON.parse(testRaw); } catch { /* */ }
      debugSelfTest = {
        url: testUrl,
        httpStatus: testRes.status,
        rawSnippet: testRaw.slice(0, 500),
        hasResults: !!testData?.results?.length,
        resultsLength: testData?.results?.length ?? 0,
      };
    } catch (e) {
      debugSelfTest = { error: (e as Error).message };
    }

    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const results: any[] = [];

    // Process assets sequentially to avoid rate limits
    for (const asset of assets) {
      try {
        const ticker = encodeURIComponent(String(asset.ticker).trim().toUpperCase());
        // Build URL as plain string - do NOT use searchParams.set for modules
        // because it encodes commas as %2C which BRAPI rejects with 400
        const brapiUrl = `https://brapi.dev/api/quote/${ticker}?token=${brapiToken}&modules=summaryProfile,defaultKeyStatistics,financialData,dividendsData`;

        console.log(`BRAPI fetch ${asset.ticker}: ${brapiUrl}`);
        const brapiRes = await fetch(brapiUrl);
        const rawText = await brapiRes.text();
        console.log(`BRAPI ${asset.ticker}: status=${brapiRes.status}, bodyLen=${rawText.length}`);

        if (!brapiRes.ok) {
          results.push({
            ticker: asset.ticker, ok: false, step: "fetch",
            status: brapiRes.status,
            error: `HTTP ${brapiRes.status}: ${rawText.slice(0, 300)}`,
          });
          continue;
        }

        let brapiData: any;
        try {
          brapiData = JSON.parse(rawText);
        } catch {
          results.push({
            ticker: asset.ticker, ok: false, step: "parse",
            error: `Invalid JSON: ${rawText.slice(0, 300)}`,
          });
          continue;
        }

        if (brapiData?.error) {
          results.push({
            ticker: asset.ticker, ok: false, step: "brapi_error",
            error: brapiData?.message ?? JSON.stringify(brapiData).slice(0, 300),
          });
          continue;
        }

        if (!brapiData?.results?.length) {
          results.push({
            ticker: asset.ticker, ok: false, step: "no_results",
            error: `No results array. Body: ${rawText.slice(0, 300)}`,
          });
          continue;
        }

        const quote = brapiData.results[0];
        const now = new Date().toISOString();

        // ---- PRICE CACHE ----
        const priceData = {
          asset_id: asset.id,
          last_price: quote.regularMarketPrice ?? null,
          change_percent: quote.regularMarketChangePercent ?? null,
          logo_url: quote.logourl ?? null,
          updated_at: now,
          source: "brapi",
        };

        const { error: priceErr } = await serviceClient
          .from("price_cache")
          .upsert(priceData, { onConflict: "asset_id" });

        if (priceErr) {
          results.push({ ticker: asset.ticker, ok: false, step: "upsert_price", error: priceErr.message });
          continue;
        }

        // ---- DIVIDENDS CACHE ----
        let div12m = 0;
        let dy12m = 0;
        const price = safeNum(quote.regularMarketPrice) ?? 0;

        if (quote?.dividendsData?.cashDividends?.length) {
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

        const { error: divErr } = await serviceClient.from("dividends_cache").upsert(
          { asset_id: asset.id, div_12m: div12m, dy_12m: dy12m, updated_at: now, source: "brapi" },
          { onConflict: "asset_id" }
        );

        if (divErr) {
          results.push({ ticker: asset.ticker, ok: false, step: "upsert_div", error: divErr.message });
          continue;
        }

        // ---- FUNDAMENTALS CACHE ----
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
        const dividendYield = dy12m > 0 ? dy12m : (ks.dividendYield != null ? pctFromRatio(ks.dividendYield) : null);

        const { error: fundErr } = await serviceClient
          .from("fundamentals_cache")
          .upsert({
            asset_id: asset.id, updated_at: now, source: "brapi",
            lpa: lpa ?? null, vpa: vpa ?? null, roe: roe ?? null, roe_5y: null,
            payout: payout ?? null, payout_5y: null, pe_ratio: peRatio ?? null,
            pb_ratio: pbRatio ?? null, ev: ev ?? null, ebitda: ebitda ?? null,
            net_debt: netDebt ?? null, total_shares: totalShares ?? null,
            dividend_yield: dividendYield ?? null, margin: margin ?? null,
            revenue_growth: revenueGrowth ?? null,
          }, { onConflict: "asset_id" });

        if (fundErr) {
          results.push({ ticker: asset.ticker, ok: false, step: "upsert_fund", error: fundErr.message });
          continue;
        }

        results.push({
          ticker: quote.symbol ?? asset.ticker, ok: true,
          price: priceData.last_price, change: priceData.change_percent,
          div12m, dy12m,
        });
      } catch (tickerErr) {
        results.push({ ticker: asset.ticker, ok: false, step: "catch", error: (tickerErr as Error).message });
      }
    }

    const ok_count = results.filter((r) => r.ok).length;
    const error_count = results.length - ok_count;

    return new Response(JSON.stringify({
      updated: results.length,
      ok_count,
      error_count,
      debug: {
        tokenPresent: true,
        tokenLen: brapiToken.length,
        selfTest: debugSelfTest,
      },
      results,
    }), {
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
