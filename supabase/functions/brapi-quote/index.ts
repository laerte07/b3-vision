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

async function fetchBrapi(ticker: string, brapiToken: string): Promise<{ data: any; raw: string; status: number; limitedPlan: boolean }> {
  const enc = encodeURIComponent(ticker.trim().toUpperCase());

  // Try with full modules first
  const fullUrl = `https://brapi.dev/api/quote/${enc}?token=${brapiToken}&modules=summaryProfile,defaultKeyStatistics,financialData,dividendsData`;
  console.log(`BRAPI full URL for ${ticker}:`, fullUrl);
  const fullRes = await fetch(fullUrl);
  const fullRaw = await fullRes.text();
  console.log(`BRAPI full ${ticker}: status=${fullRes.status}, len=${fullRaw.length}`);

  if (fullRes.ok) {
    const parsed = JSON.parse(fullRaw);
    return { data: parsed, raw: fullRaw, status: fullRes.status, limitedPlan: false };
  }

  // Check if it's a modules limitation (HTTP 400)
  if (fullRes.status === 400) {
    const isModulesError = fullRaw.includes("MODULES_NOT_AVAILABLE") || fullRaw.includes("modules");
    if (isModulesError) {
      console.log(`BRAPI ${ticker}: limited plan detected, retrying with summaryProfile only`);
      // Retry with only summaryProfile (allowed on basic plan)
      const simpleUrl = `https://brapi.dev/api/quote/${enc}?token=${brapiToken}&modules=summaryProfile`;
      const simpleRes = await fetch(simpleUrl);
      const simpleRaw = await simpleRes.text();
      console.log(`BRAPI simple ${ticker}: status=${simpleRes.status}, len=${simpleRaw.length}`);

      if (simpleRes.ok) {
        const parsed = JSON.parse(simpleRaw);
        return { data: parsed, raw: simpleRaw, status: simpleRes.status, limitedPlan: true };
      }
      // fallback: no modules at all
      const fallbackUrl = `https://brapi.dev/api/quote/${enc}?token=${brapiToken}`;
      const fallbackRes = await fetch(fallbackUrl);
      const fallbackRaw = await fallbackRes.text();
      if (fallbackRes.ok) {
        const parsed = JSON.parse(fallbackRaw);
        return { data: parsed, raw: fallbackRaw, status: fallbackRes.status, limitedPlan: true };
      }
      return { data: null, raw: fallbackRaw, status: fallbackRes.status, limitedPlan: true };
    }
  }

  // Non-modules error
  return { data: null, raw: fullRaw, status: fullRes.status, limitedPlan: false };
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

    const brapiToken = Deno.env.get("BRAPI_TOKEN");
    console.log("BRAPI_TOKEN present:", !!brapiToken, "length:", brapiToken?.length ?? 0);
    if (!brapiToken || brapiToken.trim().length < 5) {
      return new Response(JSON.stringify({
        error: "BRAPI_TOKEN missing/empty in Supabase secrets",
        updated: 0, ok_count: 0, error_count: 0,
      }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const results: any[] = [];
    let limitedPlanDetected = false;

    for (const asset of assets) {
      try {
        const { data: brapiData, raw: rawText, status: httpStatus, limitedPlan } = await fetchBrapi(asset.ticker, brapiToken);

        if (limitedPlan) limitedPlanDetected = true;

        if (!brapiData) {
          results.push({
            ticker: asset.ticker, ok: false, step: "fetch",
            status: httpStatus,
            error: `HTTP ${httpStatus}: ${rawText.slice(0, 300)}`,
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
            error: `No results. Body: ${rawText.slice(0, 300)}`,
          });
          continue;
        }

        const quote = brapiData.results[0];
        const now = new Date().toISOString();

        // ---- Extract sector/industry from summaryProfile ----
        const profile = quote.summaryProfile ?? {};
        const sector = profile.sector ?? quote.sector ?? null;
        const industry = profile.industry ?? quote.industry ?? null;

        // ---- PRICE CACHE (always first, always required) ----
        const lastPrice = quote.regularMarketPrice ?? quote.regularMarketPreviousClose ?? null;
        const priceData: Record<string, any> = {
          asset_id: asset.id,
          last_price: lastPrice,
          change_percent: quote.regularMarketChangePercent ?? null,
          logo_url: quote.logourl ?? null,
          updated_at: now,
          source: "brapi",
          sector: sector,
          industry: industry,
        };

        const { error: priceErr } = await serviceClient
          .from("price_cache")
          .upsert(priceData, { onConflict: "asset_id" });

        if (priceErr) {
          results.push({ ticker: asset.ticker, ok: false, step: "upsert_price", error: priceErr.message });
          continue;
        }

        // ---- DIVIDENDS CACHE (only if data available) ----
        if (quote?.dividendsData?.cashDividends?.length) {
          let div12m = 0;
          const price = safeNum(quote.regularMarketPrice) ?? 0;
          const oneYearAgo = new Date();
          oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
          const divs = quote.dividendsData.cashDividends.filter((d: any) => {
            const dt = d?.paymentDate ?? d?.date ?? d?.approvedDate ?? null;
            if (!dt) return false;
            return new Date(dt) >= oneYearAgo;
          });
          div12m = divs.reduce((s: number, d: any) => s + (safeNum(d.rate) ?? 0), 0);
          const dy12m = price > 0 ? (div12m / price) * 100 : 0;

          await serviceClient.from("dividends_cache").upsert(
            { asset_id: asset.id, div_12m: div12m, dy_12m: dy12m, updated_at: now, source: "brapi" },
            { onConflict: "asset_id" }
          );
        }

        // ---- FUNDAMENTALS CACHE (only if modules data available) ----
        const ks = quote.defaultKeyStatistics;
        const fd = quote.financialData;
        if (ks || fd) {
          const ksData = ks || {};
          const fdData = fd || {};
          const lpa = safeNum(quote.earningsPerShare) ?? safeNum(ksData.trailingEps);
          const vpa = safeNum(ksData.bookValue);
          const roe = pctFromRatio(fdData.returnOnEquity);
          const peRatio = safeNum(quote.priceEarnings) ?? safeNum(ksData.trailingPE);
          const pbRatio = safeNum(ksData.priceToBook);
          const ev = safeNum(ksData.enterpriseValue);
          const ebitda = safeNum(fdData.ebitda);
          const totalShares = safeNum(ksData.sharesOutstanding) ?? safeNum(ksData.impliedSharesOutstanding);
          const margin = pctFromRatio(fdData.profitMargins);
          const revenueGrowth = pctFromRatio(fdData.revenueGrowth);
          const payout = pctFromRatio(ksData.payoutRatio);
          const totalDebt = safeNum(fdData.totalDebt);
          const totalCash = safeNum(fdData.totalCash);
          const netDebt = (totalDebt != null && totalCash != null) ? (totalDebt - totalCash) : null;
          const price = safeNum(quote.regularMarketPrice) ?? 0;
          const div12m = safeNum(quote?.dividendsData?.cashDividends?.reduce?.((s: number, d: any) => s + (safeNum(d.rate) ?? 0), 0));
          const dy12m = (div12m && price > 0) ? (div12m / price) * 100 : null;
          const dividendYield = dy12m ?? (ksData.dividendYield != null ? pctFromRatio(ksData.dividendYield) : null);

          await serviceClient.from("fundamentals_cache").upsert({
            asset_id: asset.id, updated_at: now, source: "brapi",
            lpa: lpa ?? null, vpa: vpa ?? null, roe: roe ?? null, roe_5y: null,
            payout: payout ?? null, payout_5y: null, pe_ratio: peRatio ?? null,
            pb_ratio: pbRatio ?? null, ev: ev ?? null, ebitda: ebitda ?? null,
            net_debt: netDebt ?? null, total_shares: totalShares ?? null,
            dividend_yield: dividendYield ?? null, margin: margin ?? null,
            revenue_growth: revenueGrowth ?? null,
          }, { onConflict: "asset_id" });
        }

        results.push({
          ticker: quote.symbol ?? asset.ticker,
          ok: true,
          step: limitedPlan ? "limited_plan" : "full",
          price: lastPrice,
          change: priceData.change_percent,
          sector: sector,
          industry: industry,
        });
      } catch (tickerErr) {
        results.push({ ticker: asset.ticker, ok: false, step: "catch", error: (tickerErr as Error).message });
      }
    }

    const ok_count = results.filter((r) => r.ok).length;
    const error_count = results.length - ok_count;

    console.log(`BRAPI SUMMARY: ok=${ok_count}, errors=${error_count}, limitedPlan=${limitedPlanDetected}, tokenPresent=true`);

    return new Response(JSON.stringify({
      updated: ok_count,
      ok_count,
      error_count,
      debug: {
        tokenPresent: true,
        tokenLen: brapiToken.length,
        limitedPlanDetected,
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
