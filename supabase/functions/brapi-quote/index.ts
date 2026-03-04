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

async function safeJson(res: Response) {
  const text = await res.text();
  try {
    return { ok: true, data: JSON.parse(text), raw: text };
  } catch {
    return { ok: false, data: null, raw: text };
  }
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
    if (!brapiToken) {
      return new Response(JSON.stringify({ error: "Missing BRAPI_TOKEN secret in Supabase Edge Functions", updated: 0, ok_count: 0, error_count: assets.length }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const results: any[] = [];
    const modules = "summaryProfile,defaultKeyStatistics,financialData,dividendsData";

    for (const asset of assets) {
      try {
        const url = new URL(`https://brapi.dev/api/quote/${asset.ticker}`);
        url.searchParams.set("token", brapiToken);
        url.searchParams.set("modules", modules);

        const brapiRes = await fetch(url.toString());
        const parsed = await safeJson(brapiRes);

        if (!brapiRes.ok) {
          results.push({
            ticker: asset.ticker,
            ok: false,
            step: "fetch",
            error: `BRAPI ${brapiRes.status}: ${parsed.raw?.slice(0, 300) ?? "no-body"}`,
          });
          continue;
        }

        if (!parsed.ok || !parsed.data) {
          results.push({
            ticker: asset.ticker,
            ok: false,
            step: "parse",
            error: `Invalid JSON from BRAPI: ${parsed.raw?.slice(0, 300) ?? "no-body"}`,
          });
          continue;
        }

        const brapiData = parsed.data;

        // BRAPI às vezes retorna { error: true, message: "..."} (sem results)
        if (brapiData?.error) {
          results.push({
            ticker: asset.ticker,
            ok: false,
            step: "brapi",
            error: brapiData?.message ?? "BRAPI error=true",
          });
          continue;
        }

        if (!brapiData?.results?.length) {
          results.push({
            ticker: asset.ticker,
            ok: false,
            step: "results",
            error: brapiData?.message ?? "No BRAPI results",
          });
          continue;
        }

        const quote = brapiData.results[0];
        const now = new Date().toISOString();

        // ---------------- PRICE CACHE ----------------
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
          results.push({ ticker: asset.ticker, ok: false, step: "price_cache", error: priceErr.message });
          continue;
        }

        // ---------------- DIVIDENDS CACHE (sempre upsert) ----------------
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
          {
            asset_id: asset.id,
            div_12m: div12m,
            dy_12m: dy12m,
            updated_at: now,
            source: "brapi",
          },
          { onConflict: "asset_id" }
        );

        if (divErr) {
          results.push({ ticker: asset.ticker, ok: false, step: "dividends_cache", error: divErr.message });
          continue;
        }

        // ---------------- FUNDAMENTALS CACHE ----------------
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

        const { error: fundErr } = await serviceClient
          .from("fundamentals_cache")
          .upsert(fundamentalsData, { onConflict: "asset_id" });

        if (fundErr) {
          results.push({ ticker: asset.ticker, ok: false, step: "fundamentals_cache", error: fundErr.message });
          continue;
        }

        results.push({
          ticker: quote.symbol ?? asset.ticker,
          ok: true,
          price: priceData.last_price,
          change: priceData.change_percent,
          div12m,
          dy12m,
        });
      } catch (tickerErr) {
        results.push({ ticker: asset.ticker, ok: false, step: "catch", error: (tickerErr as Error).message });
      }
    }

    const ok_count = results.filter((r) => r.ok).length;
    const error_count = results.length - ok_count;

    return new Response(JSON.stringify({ updated: results.length, ok_count, error_count, results }), {
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
