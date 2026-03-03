// supabase/functions/brapi-quote/index.ts
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

/**
 * BRAPI/Yahoo às vezes retorna ratio (0.12) e às vezes já vem em % (12).
 * Heurística segura:
 * - se |n| <= 1 -> assume ratio e converte para %
 * - senão -> assume que já é percentual
 */
function pctFromRatio(v: any): number | null {
  const n = safeNum(v);
  if (n === null) return null;
  return n <= 1 && n >= -1 ? n * 100 : n;
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

    // client com o token do usuário
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    // pega usuário (mais estável que claims em alguns setups)
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData?.user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized", detail: userError?.message ?? "No user" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const userId = userData.user.id;

    // ativos ativos do usuário
    const { data: assets, error: assetsErr } = await supabase
      .from("assets")
      .select("id, ticker")
      .eq("user_id", userId)
      .eq("active", true);

    if (assetsErr || !assets || assets.length === 0) {
      return new Response(JSON.stringify({ error: "No active assets found", updated: 0, ok_count: 0, error_count: 0 }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const brapiToken = Deno.env.get("BRAPI_TOKEN");
    if (!brapiToken) {
  return new Response(JSON.stringify({ error: "Missing BRAPI_TOKEN" }), {
    status: 500,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
    }

    // service role para atualizar caches
    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const results: any[] = [];
    const modules = "summaryProfile,defaultKeyStatistics,financialData,dividendsData";

    // 1 ticker por request (limites do plano) — já está ok
    for (const asset of assets) {
      try {
        const now = new Date().toISOString();

        // ---- 1) tenta com modules (fundamentos + dividendos) ----
        const modules = "summaryProfile,defaultKeyStatistics,financialData,dividendsData";
        const brapiUrl = `https://brapi.dev/api/quote/${asset.ticker}?token=${brapiToken}&modules=${modules}`;
        let brapiRes = await fetch(brapiUrl);

        // fallback: se modules falhar (plano), tenta sem modules só para preço
        if (!brapiRes.ok) {
          const errText = await brapiRes.text();
          // tenta sem modules para não deixar tudo "Desatualizado"
          const fallbackUrl = `https://brapi.dev/api/quote/${asset.ticker}?token=${brapiToken}`;
          const fallbackRes = await fetch(fallbackUrl);

          if (!fallbackRes.ok) {
            const fbText = await fallbackRes.text();
            results.push({
              ticker: asset.ticker,
              ok: false,
              step: "fetch",
              error: `BRAPI modules FAIL ${brapiRes.status}: ${errText} | fallback FAIL ${fallbackRes.status}: ${fbText}`,
            });
            continue;
          }

          const fbData = await fallbackRes.json();
          if (!fbData?.results?.length) {
            results.push({ ticker: asset.ticker, ok: false, step: "fetch", error: "No BRAPI results (fallback)" });
            continue;
          }

          const quote = fbData.results[0];

          // ---- atualiza preço SEMPRE ----
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

          results.push({
            ticker: quote.symbol ?? asset.ticker,
            ok: true,
            note: "Atualizou preço via fallback (sem modules).",
            price: priceData.last_price,
            change: priceData.change_percent,
          });
          continue;
        }

        // ---- 2) parse normal com modules ----
        const brapiData = await brapiRes.json();
        if (!brapiData?.results?.length) {
          results.push({ ticker: asset.ticker, ok: false, step: "fetch", error: "No BRAPI results" });
          continue;
        }

        const quote = brapiData.results[0];

        // ---- PRICE CACHE (sempre) ----
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

        // ---- DIVIDENDS CACHE (sempre upsert; null quando não tem dados) ----
        let div12m: number | null = null;
        let dy12m: number | null = null;

        const price = safeNum(quote.regularMarketPrice) ?? 0;

        if (quote.dividendsData?.cashDividends?.length) {
          const oneYearAgo = new Date();
          oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

          const divs = quote.dividendsData.cashDividends.filter((d: any) => {
            const dt = d?.paymentDate ?? d?.date ?? d?.approvedDate ?? null;
            if (!dt) return false;
            return new Date(dt) >= oneYearAgo;
          });

          const sum = divs.reduce((s: number, d: any) => s + (safeNum(d?.rate) ?? 0), 0);
          div12m = Number.isFinite(sum) ? sum : null;
          dy12m = price > 0 && div12m != null ? (div12m / price) * 100 : null;
        }

        const { error: divErr } = await serviceClient
          .from("dividends_cache")
          .upsert(
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
          // NÃO dá continue — preço já foi atualizado; segue para fundamentals se der
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

        // dividend_yield: prefere dy12m calculado; fallback para ks.dividendYield
        const dividendYield =
          (dy12m != null && dy12m > 0)
            ? dy12m
            : (ks.dividendYield != null ? pctFromRatio(ks.dividendYield) : null);

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
          dividendYield,
          roe,
          payout,
          peRatio,
          pbRatio,
          margin,
          revenueGrowth,
        });
      } catch (tickerErr) {
        results.push({ ticker: asset.ticker, ok: false, step: "catch", error: (tickerErr as Error).message });
      }
    }

    const ok_count = results.filter((r) => r.ok).length;
    const error_count = results.filter((r) => !r.ok).length;

    return new Response(JSON.stringify({ updated: ok_count, ok_count, error_count, results }), {
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
