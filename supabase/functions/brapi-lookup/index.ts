import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function safeNum(v: any): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: u, error: uErr } = await supabase.auth.getUser();
    if (uErr || !u?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { ticker } = await req.json();
    if (!ticker || typeof ticker !== "string") {
      return new Response(JSON.stringify({ error: "Informe um ticker" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const brapiToken = Deno.env.get("BRAPI_TOKEN");
    if (!brapiToken) {
      return new Response(JSON.stringify({ error: "BRAPI_TOKEN ausente" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const t = ticker.trim().toUpperCase();
    const url = `https://brapi.dev/api/quote/${encodeURIComponent(t)}?token=${brapiToken}&modules=summaryProfile,defaultKeyStatistics,dividendsData`;
    const res = await fetch(url);
    const raw = await res.text();
    if (!res.ok) {
      // try simpler call
      const fb = await fetch(`https://brapi.dev/api/quote/${encodeURIComponent(t)}?token=${brapiToken}`);
      if (!fb.ok) {
        return new Response(JSON.stringify({ found: false, error: "Ativo não encontrado" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const data = await fb.json();
      const q = data?.results?.[0];
      if (!q) {
        return new Response(JSON.stringify({ found: false }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({
        found: true, ticker: q.symbol ?? t, name: q.longName ?? q.shortName ?? null,
        price: safeNum(q.regularMarketPrice), dy: null, sector: null,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const data = JSON.parse(raw);
    const q = data?.results?.[0];
    if (!q) {
      return new Response(JSON.stringify({ found: false, error: "Ativo não encontrado" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const price = safeNum(q.regularMarketPrice);
    let dy: number | null = null;
    if (Array.isArray(q?.dividendsData?.cashDividends) && price && price > 0) {
      const oneYearAgo = new Date();
      oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
      const div12m = q.dividendsData.cashDividends
        .filter((d: any) => {
          const dt = d?.paymentDate ?? d?.date ?? d?.approvedDate;
          return dt && new Date(dt) >= oneYearAgo;
        })
        .reduce((s: number, d: any) => s + (safeNum(d.rate) ?? 0), 0);
      dy = (div12m / price) * 100;
    }

    const sector = q?.summaryProfile?.sector ?? q?.summaryProfile?.sectorDisp ?? null;

    return new Response(JSON.stringify({
      found: true,
      ticker: q.symbol ?? t,
      name: q.longName ?? q.shortName ?? null,
      price,
      dy,
      sector,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});