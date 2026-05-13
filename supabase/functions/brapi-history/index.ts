import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function monthKeyFromUnixSeconds(seconds: number): string | null {
  const date = new Date(seconds * 1000);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const tickers = Array.isArray(body?.tickers)
      ? body.tickers
          .filter((ticker: unknown) => typeof ticker === "string")
          .map((ticker: string) => ticker.trim().toUpperCase())
          .filter(Boolean)
      : [];

    const uniqueTickers = [...new Set(tickers)].slice(0, 60);
    if (uniqueTickers.length === 0) {
      return new Response(JSON.stringify({ prices: {}, results: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const brapiToken = Deno.env.get("BRAPI_TOKEN");
    if (!brapiToken) {
      return new Response(JSON.stringify({ error: "BRAPI_TOKEN ausente" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const prices: Record<string, Record<string, number>> = {};
    const results: Array<{ ticker: string; ok: boolean; points?: number; error?: string }> = [];

    for (const ticker of uniqueTickers) {
      try {
        const url = `https://brapi.dev/api/quote/${encodeURIComponent(ticker)}?range=1y&interval=1mo&token=${brapiToken}`;
        const res = await fetch(url);
        const raw = await res.text();

        if (!res.ok) {
          results.push({ ticker, ok: false, error: `HTTP ${res.status}: ${raw.slice(0, 180)}` });
          continue;
        }

        const data = JSON.parse(raw);
        const quote = data?.results?.[0];
        const history = Array.isArray(quote?.historicalDataPrice) ? quote.historicalDataPrice : [];
        const byMonth: Record<string, number> = {};

        for (const point of history) {
          const key = monthKeyFromUnixSeconds(Number(point?.date));
          const close = Number(point?.adjustedClose ?? point?.close);
          if (!key || !Number.isFinite(close) || close <= 0) continue;
          byMonth[key] = close;
        }

        if (quote?.regularMarketPrice) {
          const now = new Date();
          const currentKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
          byMonth[currentKey] = Number(quote.regularMarketPrice);
        }

        prices[ticker] = byMonth;
        results.push({ ticker, ok: Object.keys(byMonth).length > 0, points: Object.keys(byMonth).length });
      } catch (err) {
        results.push({ ticker, ok: false, error: (err as Error).message });
      }
    }

    return new Response(JSON.stringify({ prices, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});